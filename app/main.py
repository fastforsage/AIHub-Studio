import sys, os, json, logging, ctypes, traceback
from logging.handlers import RotatingFileHandler
from pathlib import Path
from urllib.parse import urlsplit

import requests
import psutil
from PySide6.QtCore import QTimer, QUrl, QRunnable, QThreadPool, QObject, Signal, Qt, qInstallMessageHandler, QtMsgType
from PySide6.QtWidgets import QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QLineEdit, QFrame, QGridLayout, QMessageBox, QInputDialog, QComboBox, QFormLayout, QGroupBox, QScrollArea, QListWidget, QListWidgetItem, QSplitter, QStackedWidget, QAbstractItemView, QDialog, QTextEdit, QDialogButtonBox, QMenu
from PySide6.QtGui import QDesktopServices, QFont
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEngineProfile, QWebEnginePage

def _dpapi_transform(data, decrypt=False):
    class DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", ctypes.c_uint), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]
    raw = bytes(data)
    buffer = (ctypes.c_ubyte * len(raw)).from_buffer_copy(raw)
    source = DATA_BLOB(len(raw), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    target = DATA_BLOB()
    crypt = ctypes.windll.crypt32
    kernel = ctypes.windll.kernel32
    crypt.CryptProtectData.argtypes = [ctypes.POINTER(DATA_BLOB), ctypes.c_wchar_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint, ctypes.POINTER(DATA_BLOB)]
    crypt.CryptProtectData.restype = ctypes.c_int
    crypt.CryptUnprotectData.argtypes = [ctypes.POINTER(DATA_BLOB), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint, ctypes.POINTER(DATA_BLOB)]
    crypt.CryptUnprotectData.restype = ctypes.c_int
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    if decrypt:
        ok = crypt.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 0, ctypes.byref(target))
    else:
        ok = crypt.CryptProtectData(ctypes.byref(source), "AIHub Studio", None, None, None, 0, ctypes.byref(target))
    if not ok:
        raise ctypes.WinError()
    try:
        return ctypes.string_at(target.pbData, target.cbData)
    finally:
        kernel.LocalFree(ctypes.cast(target.pbData, ctypes.c_void_p))

def load_secret_store():
    path = CONFIG_DIR / "secrets.dpapi"
    if not path.exists() or sys.platform != "win32":
        return {}
    try:
        return json.loads(_dpapi_transform(path.read_bytes(), decrypt=True).decode("utf-8"))
    except Exception:
        logger.exception("Не удалось расшифровать локальное хранилище секретов")
        return {}

def save_secret_store(secrets):
    if sys.platform != "win32":
        return
    encrypted = _dpapi_transform(json.dumps(secrets, ensure_ascii=False).encode("utf-8"))
    (CONFIG_DIR / "secrets.dpapi").write_bytes(encrypted)

CONFIG_DIR = Path(os.environ.get("APPDATA", str(Path.home()))) / "AIHubStudio"
CONFIG_DIR.mkdir(parents=True, exist_ok=True)
CFG = CONFIG_DIR / "settings.json"
AI_CATALOG_URL = "https://silentcoderhere.github.io/aihub-config-data/ais.json"
AI_CATALOG_CACHE = CONFIG_DIR / "ais.json"
LOG_FILE = CONFIG_DIR / "AIHubStudio.log"
logger = logging.getLogger("AIHubStudio")
logger.setLevel(logging.INFO)
if not logger.handlers:
    _handler = RotatingFileHandler(LOG_FILE, maxBytes=2 * 1024 * 1024, backupCount=3, encoding="utf-8")
    _handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)s | %(message)s"))
    logger.addHandler(_handler)

def _log_uncaught(exc_type, exc_value, exc_tb):
    logger.error("Необработанное исключение", exc_info=(exc_type, exc_value, exc_tb))
sys.excepthook = _log_uncaught

def _qt_message_handler(mode, context, message):
    if mode in (QtMsgType.QtWarningMsg, QtMsgType.QtCriticalMsg, QtMsgType.QtFatalMsg):
        category = getattr(context, "category", "") or "Qt"
        logger.warning("%s: %s", category, message)
qInstallMessageHandler(_qt_message_handler)

DEFAULTS = {
    "servers": {
        "dockhand": {"scheme": "https", "host": "", "port": 443, "path": ""},
        "openwebui": {"scheme": "https", "host": "", "port": 443, "path": ""},
        "gpu": {"scheme": "http", "host": "", "port": 8765, "path": ""}
    },
    "gpu_agent_token": "",
    "proxy_url": "",
    "active_connection_profile": "Локальная сеть",
    "connection_profiles": {},
    "ai_services": [
        {"name": "ChatGPT", "url": "https://chatgpt.com"},
        {"name": "Claude", "url": "https://claude.ai"},
        {"name": "Gemini", "url": "https://gemini.google.com"},
        {"name": "OpenRouter", "url": "https://openrouter.ai"}
    ],
    "enabled_ai_services": ["ChatGPT", "Claude", "Gemini", "OpenRouter"]
}

def split_legacy_url(value, default_scheme, default_port):
    try:
        parsed = urlsplit(value if "://" in value else default_scheme + "://" + value)
        return {"scheme": parsed.scheme if parsed.scheme in ("http", "https") else default_scheme,
                "host": parsed.hostname or "", "port": parsed.port or default_port,
                "path": parsed.path.strip("/")}
    except Exception:
        return {"scheme": default_scheme, "host": "", "port": default_port, "path": ""}

def load_cfg():
    cfg = json.loads(json.dumps(DEFAULTS))
    try:
        saved = json.loads(CFG.read_text(encoding="utf-8"))
        cfg.update(saved)
        if "servers" not in saved:
            cfg["servers"] = {
                "dockhand": split_legacy_url(saved.get("dockhand_url", ""), "https", 443),
                "openwebui": split_legacy_url(next((x.get("url", "") for x in saved.get("ai_services", []) if x.get("name", "").lower() == "open webui"), ""), "https", 443),
                "gpu": split_legacy_url(saved.get("gpu_agent_url", ""), "http", 8765)
            }
        else:
            for key, defaults in DEFAULTS["servers"].items():
                cfg["servers"].setdefault(key, defaults.copy())
        cfg["ai_services"] = [x for x in cfg.get("ai_services", []) if x.get("name", "").lower() != "open webui"]
        if "enabled_ai_services" not in saved:
            cfg["enabled_ai_services"] = [x.get("name", "") for x in cfg["ai_services"] if x.get("name")]
    except Exception:
        pass
    profiles = cfg.get("connection_profiles") or {}
    if not profiles:
        profiles = {"Локальная сеть": {"servers": cfg["servers"], "gpu_agent_token": cfg.get("gpu_agent_token", "")}, "Частное облако": {"servers": json.loads(json.dumps(DEFAULTS["servers"])), "gpu_agent_token": ""}}
    profiles.setdefault("Частное облако", {"servers": json.loads(json.dumps(DEFAULTS["servers"])), "gpu_agent_token": ""})
    cfg["connection_profiles"] = profiles
    active = cfg.get("active_connection_profile", "Локальная сеть")
    if active not in profiles:
        active = next(iter(profiles))
    cfg["active_connection_profile"] = active
    cfg["servers"] = profiles[active].get("servers", cfg["servers"])
    cfg["gpu_agent_token"] = profiles[active].get("gpu_agent_token", cfg.get("gpu_agent_token", ""))
    secrets = load_secret_store()
    cfg["proxy_url"] = secrets.get("proxy_url", cfg.get("proxy_url", ""))
    cfg["service_last_urls"] = secrets.get("service_last_urls", cfg.get("service_last_urls", {}))
    for profile_name, profile_data in cfg["connection_profiles"].items():
        profile_data["gpu_agent_token"] = secrets.get("gpu_agent_tokens", {}).get(profile_name, profile_data.get("gpu_agent_token", ""))
    cfg["gpu_agent_token"] = cfg["connection_profiles"][active].get("gpu_agent_token", cfg.get("gpu_agent_token", ""))
    return cfg

def load_ai_catalog_cache():
    try:
        raw = json.loads(AI_CATALOG_CACHE.read_text(encoding="utf-8"))
        return normalize_ai_catalog(raw)
    except Exception:
        return []

def normalize_ai_catalog(raw):
    result, seen = [], set()
    if isinstance(raw, list):
        entries = [(str(item.get("category", "other")), item, "url") for item in raw if isinstance(item, dict)]
    elif isinstance(raw, dict):
        entries = [(str(category), item, "website") for category, items in raw.items() if isinstance(items, list) for item in items if isinstance(item, dict)]
    else:
        raise ValueError("Каталог должен быть JSON-объектом с категориями или нормализованным списком.")
    for category, item, url_key in entries:
        name = str(item.get("name", "")).strip()
        url = str(item.get(url_key, "")).strip()
        if not name or not url.startswith(("https://", "http://")):
            continue
        key = name.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append({
            "name": name, "url": url, "category": category,
            "pricing": str(item.get("pricing", "unknown")),
            "privacy": str(item.get("privacy", "unknown")),
            "login_required": bool(item.get("login_required", False)),
            "best_for": item.get("best_for", []) if isinstance(item.get("best_for", []), list) else []
        })
    return result

class CatalogFetchSignals(QObject):
    finished = Signal(object, str)

class CatalogFetchWorker(QRunnable):
    def __init__(self, proxies=None):
        super().__init__()
        self.proxies = proxies or {}
        self.signals = CatalogFetchSignals()
    def run(self):
        try:
            response = requests.get(AI_CATALOG_URL, timeout=(5, 15), proxies=self.proxies)
            response.raise_for_status()
            services = normalize_ai_catalog(response.json())
            if not services:
                raise ValueError("В удалённом каталоге не найдено сервисов.")
            self.signals.finished.emit(services, "")
        except Exception as exc:
            logger.exception("Ошибка загрузки каталога AI")
            self.signals.finished.emit([], str(exc))

def save_cfg(cfg):
    clean = json.loads(json.dumps({k: v for k, v in cfg.items() if k not in ("dockhand_url", "gpu_agent_url", "gpu_agent_token", "proxy_url", "service_last_urls")}))
    clean["ai_services"] = [x for x in clean.get("ai_services", []) if x.get("name", "").lower() != "open webui"]
    active = clean.get("active_connection_profile", "Локальная сеть")
    profiles = clean.setdefault("connection_profiles", {})
    profiles[active] = {"servers": clean.get("servers", {}), "gpu_agent_token": cfg.get("gpu_agent_token", "")}
    token_secrets = {}
    for profile_name, profile_data in profiles.items():
        token = profile_data.get("gpu_agent_token", "")
        if token: token_secrets[profile_name] = token
        profile_data.pop("gpu_agent_token", None)
    save_secret_store({"proxy_url": cfg.get("proxy_url", ""), "gpu_agent_tokens": token_secrets, "service_last_urls": cfg.get("service_last_urls", {})})
    clean["proxy_configured"] = bool(cfg.get("proxy_url", ""))
    CFG.write_text(json.dumps(clean, ensure_ascii=False, indent=2), encoding="utf-8")

def server_url(item):
    host = item.get("host", "").strip()
    if not host:
        return ""
    scheme = item.get("scheme", "https")
    port = int(item.get("port") or (443 if scheme == "https" else 80))
    default_port = 443 if scheme == "https" else 80
    authority = host if port == default_port else f"{host}:{port}"
    path = item.get("path", "").strip("/")
    return f"{scheme}://{authority}" + (f"/{path}" if path else "")

class Metric(QFrame):
    def __init__(self, title):
        super().__init__()
        self.setObjectName("metric")
        layout = QVBoxLayout(self)
        layout.addWidget(QLabel(title))
        self.value = QLabel("—")
        self.value.setObjectName("metricValue")
        layout.addWidget(self.value)
    def set(self, value):
        self.value.setText(str(value))

class ServerFields(QGroupBox):
    def __init__(self, title, values):
        super().__init__(title)
        form = QFormLayout(self)
        self.scheme = QComboBox()
        self.scheme.addItems(["https", "http"])
        self.scheme.setCurrentText(values.get("scheme", "https"))
        self.host = QLineEdit(values.get("host", ""))
        self.host.setPlaceholderText("DNS-имя или IP-адрес")
        self.port = QLineEdit(str(values.get("port", 443)))
        self.port.setPlaceholderText("Порт")
        self.path = QLineEdit(values.get("path", ""))
        self.path.setPlaceholderText("Необязательно, например /")
        form.addRow("Протокол", self.scheme)
        form.addRow("DNS / IP", self.host)
        form.addRow("Порт", self.port)
        form.addRow("Путь (если нужен)", self.path)
    def load_values(self, values):
        self.scheme.setCurrentText(values.get("scheme", "https"))
        self.host.setText(values.get("host", ""))
        self.port.setText(str(values.get("port", 443)))
        self.path.setText(values.get("path", ""))

    def values(self):
        host = self.host.text().strip()
        if host.startswith("http://") or host.startswith("https://"):
            raise ValueError("В поле DNS / IP укажите только имя хоста или IP, без протокола.")
        port = int(self.port.text().strip())
        if not 1 <= port <= 65535:
            raise ValueError("Порт должен быть от 1 до 65535.")
        return {"scheme": self.scheme.currentText(), "host": host, "port": port, "path": self.path.text().strip().strip("/")}

class CheckSignals(QObject):
    finished = Signal(str)

class ConnectionCheck(QRunnable):
    def __init__(self, url, token="", proxies=None):
        super().__init__()
        self.url, self.token, self.proxies = url, token, (proxies or {})
        self.signals = CheckSignals()
    def run(self):
        try:
            headers = {"Authorization": "Bearer " + self.token} if self.token else {}
            response = requests.get(self.url, headers=headers, timeout=(3, 5), stream=True, proxies=self.proxies)
            code = response.status_code
            response.close()
            if code in (401, 403): result = f"Сервер доступен · HTTP {code}, нужна авторизация"
            elif code < 500: result = f"Подключение успешно · HTTP {code}"
            else: result = f"Сервер ответил · HTTP {code}"
        except requests.exceptions.SSLError: result = "Ошибка TLS/сертификата"
        except requests.exceptions.ConnectionError: result = "Нет соединения: проверьте DNS/IP, порт и LAN/VPN"
        except requests.exceptions.Timeout: result = "Тайм-аут: сервер не ответил"
        except Exception as exc: result = f"Ошибка: {exc}"
        self.signals.finished.emit(result)

class AgentFetchSignals(QObject):
    finished = Signal(object, str)

class AgentFetchWorker(QRunnable):
    def __init__(self, url, token, proxies=None):
        super().__init__()
        self.url, self.token, self.proxies = url, token, (proxies or {})
        self.signals = AgentFetchSignals()
    def run(self):
        try:
            response = requests.get(self.url.rstrip("/") + "/gpu", headers={"Authorization": "Bearer " + self.token}, timeout=(2, 4), proxies=self.proxies)
            response.raise_for_status()
            self.signals.finished.emit(response.json(), "")
        except Exception as exc:
            logger.exception("Ошибка запроса к удалённому GPU Agent")
            self.signals.finished.emit({}, str(exc))

class Main(QMainWindow):
    def __init__(self):
        super().__init__()
        self.cfg = load_cfg()
        self.thread_pool = QThreadPool.globalInstance()
        self.check_workers = []
        self.agent_worker_active = False
        self.last_agent_error = None
        self.current_service = ""
        self.web_profile = QWebEngineProfile("AIHubStudio", self)
        web_data = CONFIG_DIR / "web-profile"
        web_cache = CONFIG_DIR / "web-cache"
        web_data.mkdir(parents=True, exist_ok=True)
        web_cache.mkdir(parents=True, exist_ok=True)
        self.web_profile.setPersistentStoragePath(str(web_data))
        self.web_profile.setCachePath(str(web_cache))
        self.web_profile.setPersistentCookiesPolicy(QWebEngineProfile.ForcePersistentCookies)
        self.web_profile.setHttpCacheType(QWebEngineProfile.DiskHttpCache)
        self.ai_catalog = load_ai_catalog_cache()
        self.ai_services_by_name = {}
        self.setWindowTitle("AIHub Studio")
        self.resize(1480, 920)
        self.setMinimumSize(1050, 680)

        root = QWidget()
        root_layout = QHBoxLayout(root)
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(0)
        self.setCentralWidget(root)

        sidebar = QFrame()
        sidebar.setObjectName("sidebar")
        sidebar.setFixedWidth(270)
        side_layout = QVBoxLayout(sidebar)
        side_layout.setContentsMargins(16, 22, 16, 16)
        side_layout.setSpacing(10)
        brand = QLabel("◈  AIHub Studio")
        brand.setObjectName("brand")
        side_layout.addWidget(brand)
        side_caption = QLabel("ВАШИ AI-ПОМОЩНИКИ")
        side_caption.setObjectName("sideCaption")
        side_layout.addWidget(side_caption)
        self.service_search = QLineEdit()
        self.service_search.setPlaceholderText("⌕  Найти AI-помощника")
        self.service_search.textChanged.connect(self.filter_service_list)
        side_layout.addWidget(self.service_search)

        self.service_list = QListWidget()
        self.service_list.setObjectName("serviceList")
        self.service_list.setSpacing(4)
        self.service_list.setDragDropMode(QAbstractItemView.InternalMove)
        self.service_list.setDefaultDropAction(Qt.MoveAction)
        self.service_list.model().rowsMoved.connect(self.on_service_order_changed)
        self.service_list.itemClicked.connect(self.on_service_selected)
        self.service_list.setContextMenuPolicy(Qt.CustomContextMenu)
        self.service_list.customContextMenuRequested.connect(self.service_context_menu)
        side_layout.addWidget(self.service_list, 1)

        side_divider = QFrame()
        side_divider.setFrameShape(QFrame.HLine)
        side_divider.setObjectName("sideDivider")
        side_layout.addWidget(side_divider)
        self.nav_buttons = {}
        for key, label in [("catalog", "＋  Каталог AI"), ("overview", "▦  Обзор"), ("dockhand", "▣  Dockhand"), ("settings", "⚙  Настройки")]:
            button = QPushButton(label)
            button.setObjectName("sideNav")
            button.setCheckable(True)
            button.clicked.connect(lambda checked=False, k=key: self.show_page(k))
            side_layout.addWidget(button)
            self.nav_buttons[key] = button

        splitter = QSplitter(Qt.Horizontal)
        splitter.addWidget(sidebar)
        content = QWidget()
        content_layout = QVBoxLayout(content)
        content_layout.setContentsMargins(0, 0, 0, 0)
        content_layout.setSpacing(0)
        toolbar = QFrame()
        toolbar.setObjectName("toolbar")
        toolbar_layout = QHBoxLayout(toolbar)
        toolbar_layout.setContentsMargins(18, 12, 18, 12)
        self.ai_back = QPushButton("←")
        self.ai_forward = QPushButton("→")
        self.ai_reload = QPushButton("↻")
        for control in (self.ai_back, self.ai_forward, self.ai_reload):
            control.setObjectName("toolButton")
            control.setFixedWidth(42)
            toolbar_layout.addWidget(control)
        self.page_title = QLabel("Open WebUI")
        self.page_title.setObjectName("pageTitle")
        toolbar_layout.addWidget(self.page_title)
        toolbar_layout.addStretch()
        self.ai_address = QLineEdit()
        self.ai_address.setObjectName("addressBar")
        self.ai_address.setPlaceholderText("Адрес текущего сервиса")
        self.ai_address.setMinimumWidth(260)
        toolbar_layout.addWidget(self.ai_address, 2)
        self.ai_go = QPushButton("Открыть")
        self.ai_go.setObjectName("toolButton")
        toolbar_layout.addWidget(self.ai_go)
        content_layout.addWidget(toolbar)

        self.stack = QStackedWidget()
        self.chat_view = QWebEngineView()
        self.chat_view.setPage(QWebEnginePage(self.web_profile, self.chat_view))
        self.chat_view.setFocusPolicy(Qt.ClickFocus)
        self.chat_view.urlChanged.connect(lambda qurl: self.update_ai_address_for(self.chat_view, qurl))
        self.chat_view.loadStarted.connect(lambda: logger.info("Загрузка страницы: %s", self.chat_view.url().host()))
        self.chat_view.loadFinished.connect(lambda ok: logger.info("Загрузка завершена: %s", "успешно" if ok else "ошибка"))
        self.openwebui_view = self.chat_view
        self.dock = self.chat_view
        self.stack.addWidget(self.chat_view)
        self.dashboard_widget = self.make_dashboard()
        self.stack.addWidget(self.dashboard_widget)
        self.catalog_widget = self.make_ai_catalog()
        self.stack.addWidget(self.catalog_widget)
        self.settings_widget = self.make_settings()
        self.stack.addWidget(self.settings_widget)
        content_layout.addWidget(self.stack, 1)
        splitter.addWidget(content)
        splitter.setStretchFactor(0, 0)
        splitter.setStretchFactor(1, 1)
        splitter.setSizes([270, 1210])
        root_layout.addWidget(splitter, 1)

        self.ai_back.clicked.connect(self.chat_view.back)
        self.ai_forward.clicked.connect(self.chat_view.forward)
        self.ai_reload.clicked.connect(self.chat_view.reload)
        self.ai_go.clicked.connect(self.navigate_ai_address)
        self.ai_address.returnPressed.connect(self.navigate_ai_address)

        self.sync_ai_tabs()
        self.apply_server_urls()
        self.start_catalog_fetch()
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.refresh)
        self.timer.start(5000)
        self.refresh()
        logger.info("AIHub Studio запущен")
        self.show_page("chat")
        self.select_openwebui()

    def make_ai_catalog(self):
        widget = QWidget()
        layout = QVBoxLayout(widget)
        header = QHBoxLayout()
        title = QLabel("Каталог AI-сервисов")
        title.setObjectName("heading")
        header.addWidget(title)
        self.catalog_count = QLabel("Загружаем локальный каталог…")
        header.addWidget(self.catalog_count)
        refresh = QPushButton("Обновить каталог")
        refresh.clicked.connect(self.start_catalog_fetch)
        header.addWidget(refresh)
        layout.addLayout(header)

        filters = QHBoxLayout()
        self.catalog_search = QLineEdit()
        self.catalog_search.setPlaceholderText("Поиск по названию и назначению…")
        self.catalog_search.textChanged.connect(self.populate_ai_catalog)
        self.catalog_category = QComboBox()
        self.catalog_category.currentTextChanged.connect(self.populate_ai_catalog)
        self.catalog_pricing = QComboBox()
        self.catalog_pricing.currentTextChanged.connect(self.populate_ai_catalog)
        self.catalog_privacy = QComboBox()
        self.catalog_privacy.currentTextChanged.connect(self.populate_ai_catalog)
        self.catalog_login = QComboBox()
        self.catalog_login.addItems(["Любой доступ", "Требуется вход", "Без входа"])
        self.catalog_login.currentTextChanged.connect(self.populate_ai_catalog)
        filters.addWidget(self.catalog_search, 2)
        filters.addWidget(self.catalog_category, 1)
        filters.addWidget(self.catalog_pricing, 1)
        filters.addWidget(self.catalog_privacy, 1)
        filters.addWidget(self.catalog_login, 1)
        layout.addLayout(filters)

        self.catalog_list = QListWidget()
        self.catalog_list.itemChanged.connect(self.on_catalog_item_changed)
        layout.addWidget(self.catalog_list, 1)
        hint = QLabel("Отметьте нужные сервисы — они появятся вкладками в разделе «AI Hub». Полный каталог загружается из публичного репозитория проекта.")
        hint.setWordWrap(True)
        layout.addWidget(hint)
        self.populate_ai_catalog()
        return widget

    def start_catalog_fetch(self):
        self.catalog_count.setText("Обновляем каталог…") if hasattr(self, "catalog_count") else None
        logger.info("Запрошено обновление каталога AI")
        worker = CatalogFetchWorker(self.proxy_map())
        self.catalog_worker = worker
        worker.signals.finished.connect(self.on_catalog_loaded)
        self.thread_pool.start(worker)

    def on_catalog_loaded(self, services, error):
        if error:
            count = len(self.ai_catalog)
            self.catalog_count.setText(f"Кэш: {count} сервисов · ошибка обновления") if hasattr(self, "catalog_count") else None
            return
        self.ai_catalog = services
        try:
            AI_CATALOG_CACHE.write_text(json.dumps(services, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass
        self.populate_ai_catalog()
        self.sync_ai_tabs()
        self.catalog_count.setText(f"Загружено: {len(services)} сервисов")

    def populate_ai_catalog(self, *_):
        if not hasattr(self, "catalog_list"):
            return
        def refill(combo, options, default):
            current = combo.currentText() if combo.count() else default
            combo.blockSignals(True)
            combo.clear()
            combo.addItems(options)
            combo.setCurrentText(current if current in options else default)
            combo.blockSignals(False)

        categories = ["Все категории"] + sorted({x["category"] for x in self.ai_catalog})
        prices = ["Любая цена"] + sorted({x["pricing"] for x in self.ai_catalog})
        privacy_values = ["Любая приватность"] + sorted({x["privacy"] for x in self.ai_catalog})
        refill(self.catalog_category, categories, "Все категории")
        refill(self.catalog_pricing, prices, "Любая цена")
        refill(self.catalog_privacy, privacy_values, "Любая приватность")

        query = self.catalog_search.text().strip().casefold()
        category = self.catalog_category.currentText()
        pricing = self.catalog_pricing.currentText()
        privacy = self.catalog_privacy.currentText()
        login = self.catalog_login.currentText()
        enabled = set(self.cfg.get("enabled_ai_services", []))
        self.catalog_list.blockSignals(True)
        self.catalog_list.clear()
        for service in self.ai_catalog:
            searchable = " ".join([service["name"], service["category"], *service.get("best_for", [])]).casefold()
            if query and query not in searchable:
                continue
            if category != "Все категории" and service["category"] != category:
                continue
            if pricing != "Любая цена" and service["pricing"] != pricing:
                continue
            if privacy != "Любая приватность" and service["privacy"] != privacy:
                continue
            if login == "Требуется вход" and not service["login_required"]:
                continue
            if login == "Без входа" and service["login_required"]:
                continue
            label = f'{service["name"]}  ·  {service["category"]}  ·  {service["pricing"]}  ·  privacy: {service["privacy"]}  ·  login: {"yes" if service["login_required"] else "no"}'
            item = QListWidgetItem(label)
            item.setData(Qt.UserRole, service)
            item.setFlags(item.flags() | Qt.ItemIsUserCheckable)
            item.setCheckState(Qt.Checked if service["name"] in enabled else Qt.Unchecked)
            self.catalog_list.addItem(item)
        self.catalog_list.blockSignals(False)
        if hasattr(self, "catalog_count"):
            self.catalog_count.setText(f"В каталоге: {len(self.ai_catalog)} · показано: {self.catalog_list.count()}")

    def on_catalog_item_changed(self, item):
        service = item.data(Qt.UserRole)
        if not isinstance(service, dict):
            return
        enabled = list(self.cfg.get("enabled_ai_services", []))
        name = service["name"]
        if item.checkState() == Qt.Checked:
            if name not in enabled:
                enabled.append(name)
        else:
            enabled = [x for x in enabled if x != name]
        self.cfg["enabled_ai_services"] = enabled
        self.sync_ai_tabs()
        save_cfg(self.cfg)

    def sync_ai_tabs(self):
        available = {x["name"]: x for x in self.ai_catalog if x.get("name") and x.get("url")}
        available.update({x["name"]: x for x in self.cfg.get("ai_services", []) if x.get("name") and x.get("url")})
        enabled = list(dict.fromkeys(self.cfg.get("enabled_ai_services", [])))
        order = self.cfg.get("service_order", [])
        favorites = set(self.cfg.get("favorite_services", []))
        original_positions = {name: index for index, name in enumerate(enabled)}
        enabled.sort(key=lambda name: (0 if name in favorites else 1, order.index(name) if name in order else len(order) + original_positions[name]))
        self.ai_services_by_name = {name: available[name] for name in enabled if name in available}
        self.ai_views = self.ai_services_by_name
        self.cfg["ai_services"] = list(self.ai_services_by_name.values())
        if not hasattr(self, "service_list"): return
        selected = self.current_service
        fallback_to_openwebui = bool(selected and selected not in self.ai_services_by_name and selected != "Open WebUI")
        self.service_list.blockSignals(True)
        self.service_list.clear()
        open_item = QListWidgetItem("⌂   Open WebUI")
        open_item.setData(Qt.UserRole, {"kind": "openwebui"})
        open_item.setFlags(open_item.flags() & ~Qt.ItemIsDragEnabled)
        self.service_list.addItem(open_item)
        heading = QListWidgetItem("ОБЛАЧНЫЕ LLM")
        heading.setFlags(Qt.NoItemFlags)
        heading.setData(Qt.UserRole, {"kind": "heading"})
        self.service_list.addItem(heading)
        for name, service in self.ai_services_by_name.items():
            item = QListWidgetItem(("★   " if name in favorites else "✦   ") + name)
            item.setData(Qt.UserRole, {"kind": "service", "name": name, "url": service["url"]})
            self.service_list.addItem(item)
            if name == selected: item.setSelected(True)
        if selected == "Open WebUI": self.service_list.setCurrentItem(open_item)
        elif selected in self.ai_services_by_name:
            for row in range(self.service_list.count()):
                item = self.service_list.item(row)
                data = item.data(Qt.UserRole) or {}
                if data.get("name") == selected: self.service_list.setCurrentItem(item); break
        else:
            self.service_list.setCurrentItem(open_item)
        self.service_list.blockSignals(False)
        self.filter_service_list(self.service_search.text())
        if fallback_to_openwebui:
            self.current_service = ""
            self.select_openwebui()

    def filter_service_list(self, query):
        query = (query or "").strip().casefold()
        for row in range(self.service_list.count()):
            item = self.service_list.item(row)
            data = item.data(Qt.UserRole) or {}
            if data.get("kind") == "heading":
                item.setHidden(not any(
                    query in (self.service_list.item(i).data(Qt.UserRole) or {}).get("name", "").casefold()
                    for i in range(row + 1, self.service_list.count())
                ) if query else False)
            elif data.get("kind") == "service":
                item.setHidden(query not in data.get("name", "").casefold())
            else:
                item.setHidden(False)

    def service_context_menu(self, position):
        item = self.service_list.itemAt(position)
        if not item: return
        data = item.data(Qt.UserRole) or {}
        if data.get("kind") != "service": return
        name = data.get("name", "")
        favorites = set(self.cfg.get("favorite_services", []))
        menu = QMenu(self)
        action = menu.addAction("Убрать из избранного" if name in favorites else "В избранное")
        if menu.exec(self.service_list.mapToGlobal(position)) == action:
            if name in favorites: favorites.remove(name)
            else: favorites.add(name)
            self.cfg["favorite_services"] = sorted(favorites)
            self.sync_ai_tabs()
            save_cfg(self.cfg)

    def make_dashboard(self):
        widget = QWidget()
        outer = QVBoxLayout(widget)
        header = QHBoxLayout()
        title = QLabel("УДАЛЁННЫЙ GPU МОНИТОРИНГ")
        title.setObjectName("heading")
        header.addWidget(title)
        header.addStretch()
        self.status = QLabel("Опрос удалённого ROCm Agent каждые 5 сек.")
        header.addWidget(self.status)
        outer.addLayout(header)
        grid = QGridLayout()
        self.cpu, self.ram = Metric("Локальный CPU"), Metric("Локальная RAM")
        self.agent = Metric("Удалённый Linux ROCm Agent")
        grid.addWidget(self.cpu, 0, 0)
        grid.addWidget(self.ram, 0, 1)
        grid.addWidget(self.agent, 0, 2)
        outer.addLayout(grid)
        self.gpu_info = QLabel("Метрики будут получены с удалённого Linux-агента.")
        self.gpu_info.setObjectName("info")
        self.gpu_info.setWordWrap(True)
        outer.addWidget(self.gpu_info)
        outer.addStretch()
        return widget

    def make_settings(self):
        content = QWidget()
        layout = QVBoxLayout(content)
        layout.addWidget(QLabel("Профили позволяют отдельно хранить настройки локальной сети, частного облака или другого сервера."))
        profile_row = QHBoxLayout()
        self.profile_combo = QComboBox()
        self.profile_combo.addItems(list(self.cfg["connection_profiles"].keys()))
        self.profile_combo.setCurrentText(self.cfg["active_connection_profile"])
        self.profile_combo.currentTextChanged.connect(self.switch_connection_profile)
        profile_row.addWidget(QLabel("Профиль подключения"))
        profile_row.addWidget(self.profile_combo, 1)
        add_profile = QPushButton("Новый профиль")
        add_profile.clicked.connect(self.add_connection_profile)
        profile_row.addWidget(add_profile)
        remove_profile = QPushButton("Удалить профиль")
        remove_profile.clicked.connect(self.remove_connection_profile)
        profile_row.addWidget(remove_profile)
        layout.addLayout(profile_row)
        layout.addWidget(QLabel("Для каждого сервиса укажите протокол, DNS/IP и порт."))
        self.dock_fields = ServerFields("Dockhand", self.cfg["servers"]["dockhand"])
        self.webui_fields = ServerFields("Open WebUI", self.cfg["servers"]["openwebui"])
        self.gpu_fields = ServerFields("Удалённый GPU мониторинг · Linux ROCm Agent", self.cfg["servers"]["gpu"])
        layout.addWidget(self.server_check_row(self.dock_fields, "dockhand", "Dockhand"))
        layout.addWidget(self.server_check_row(self.webui_fields, "openwebui", "Open WebUI"))
        layout.addWidget(self.server_check_row(self.gpu_fields, "gpu", "GPU Agent"))
        token_form = QFormLayout()
        self.token = QLineEdit(self.cfg.get("gpu_agent_token", ""))
        self.token.setEchoMode(QLineEdit.Password)
        self.token.setPlaceholderText("Bearer token для GPU Agent")
        token_form.addRow("GPU Agent token", self.token)
        token_hint = QLabel("Токен нужен только для авторизованного GPU Agent. Он шифруется локально средствами Windows DPAPI; никаких запросов Windows Credential Manager и отдельных окон подтверждения нет.")
        token_hint.setWordWrap(True)
        token_form.addRow(token_hint)
        layout.addLayout(token_form)
        proxy_group = QGroupBox("Прокси для AI-сайтов и сетевых запросов")
        proxy_form = QFormLayout(proxy_group)
        self.proxy_url = QLineEdit(self.cfg.get("proxy_url", ""))
        self.proxy_url.setPlaceholderText("http://host:port или socks5://host:port")
        proxy_form.addRow("Proxy URL", self.proxy_url)
        proxy_hint = QLabel("Прокси применяется к AI-браузерам и загрузке каталога; Dockhand и GPU Agent подключаются напрямую. После изменения прокси перезапустите приложение. Для прокси с авторизацией используйте локальный прокси-клиент без пароля в URL.")
        proxy_hint.setWordWrap(True)
        proxy_form.addRow(proxy_hint)
        layout.addWidget(proxy_group)
        save_button = QPushButton("Сохранить подключения")
        save_button.clicked.connect(self.save_settings)
        layout.addWidget(save_button)
        logs_button = QPushButton("Открыть журнал приложения")
        logs_button.clicked.connect(self.show_logs)
        layout.addWidget(logs_button)
        add_button = QPushButton("Добавить внешний AI-сервис")
        add_button.clicked.connect(self.add_service_dialog)
        layout.addWidget(add_button)
        note = QLabel("GPU Agent запускается на Linux-сервере с AMD GPU. Используйте адрес из LAN/VPN; не выставляйте агент или Docker API в публичный интернет.")
        note.setWordWrap(True)
        layout.addWidget(note)
        layout.addStretch()
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setWidget(content)
        return scroll

    def show_logs(self):
        logger.info("Открыт просмотр журнала")
        dialog = QDialog(self)
        dialog.setWindowTitle("Журнал AIHub Studio")
        dialog.resize(900, 560)
        layout = QVBoxLayout(dialog)
        description = QLabel(f"Файл журнала: {LOG_FILE}")
        description.setWordWrap(True)
        layout.addWidget(description)
        viewer = QTextEdit()
        viewer.setReadOnly(True)
        viewer.setLineWrapMode(QTextEdit.NoWrap)
        viewer.setFont(QFont("Consolas", 9))
        layout.addWidget(viewer, 1)
        def reload_log():
            try:
                viewer.setPlainText(LOG_FILE.read_text(encoding="utf-8") if LOG_FILE.exists() else "Журнал пока пуст.")
                viewer.verticalScrollBar().setValue(viewer.verticalScrollBar().maximum())
            except Exception as exc:
                viewer.setPlainText("Не удалось прочитать журнал: " + str(exc))
        actions = QHBoxLayout()
        refresh = QPushButton("Обновить")
        refresh.clicked.connect(reload_log)
        copy = QPushButton("Копировать")
        copy.clicked.connect(lambda: QApplication.clipboard().setText(viewer.toPlainText()))
        folder = QPushButton("Открыть папку")
        folder.clicked.connect(lambda: QDesktopServices.openUrl(QUrl.fromLocalFile(str(CONFIG_DIR))))
        close = QPushButton("Закрыть")
        close.clicked.connect(dialog.accept)
        for button in (refresh, copy, folder, close): actions.addWidget(button)
        layout.addLayout(actions)
        reload_log()
        dialog.exec()

    def server_check_row(self, fields, key, title):
        wrap = QWidget()
        row = QHBoxLayout(wrap)
        row.setContentsMargins(0, 0, 0, 0)
        row.addWidget(fields, 1)
        button = QPushButton("Проверить")
        status = QLabel("Не проверено")
        status.setWordWrap(True)
        button.clicked.connect(lambda checked=False, k=key, b=button, st=status: self.check_server(k, b, st))
        row.addWidget(button)
        row.addWidget(status, 1)
        if not hasattr(self, "check_status"): self.check_status = {}
        self.check_status[key] = status
        return wrap

    def check_server(self, key, button, status):
        fields = {"dockhand": self.dock_fields, "openwebui": self.webui_fields, "gpu": self.gpu_fields}[key]
        try: url = server_url(fields.values())
        except ValueError as exc:
            QMessageBox.warning(self, "Проверьте настройки", str(exc))
            return
        token = self.token.text().strip() if key == "gpu" else ""
        if key == "gpu" and url: url = url.rstrip("/") + "/gpu"
        if not url:
            status.setText("Укажите DNS/IP")
            return
        button.setEnabled(False)
        status.setText("Проверяем…")
        worker = ConnectionCheck(url, token, {})
        self.check_workers.append(worker)
        def done(message, b=button, st=status, w=worker):
            st.setText(message)
            b.setEnabled(True)
            if w in self.check_workers: self.check_workers.remove(w)
        worker.signals.finished.connect(done)
        self.thread_pool.start(worker)

    def switch_connection_profile(self, name):
        if not name: return
        old = self.cfg.get("active_connection_profile", "")
        if old and old in self.cfg["connection_profiles"] and hasattr(self, "dock_fields"):
            try:
                self.cfg["connection_profiles"][old] = {"servers": {"dockhand": self.dock_fields.values(), "openwebui": self.webui_fields.values(), "gpu": self.gpu_fields.values()}, "gpu_agent_token": self.token.text().strip()}
            except (ValueError, AttributeError): pass
        profile = self.cfg["connection_profiles"].get(name, {})
        servers = profile.get("servers", DEFAULTS["servers"])
        self.dock_fields.load_values(servers.get("dockhand", DEFAULTS["servers"]["dockhand"]))
        self.webui_fields.load_values(servers.get("openwebui", DEFAULTS["servers"]["openwebui"]))
        self.gpu_fields.load_values(servers.get("gpu", DEFAULTS["servers"]["gpu"]))
        self.token.setText(profile.get("gpu_agent_token", ""))
        self.cfg["active_connection_profile"] = name
        self.cfg["servers"] = servers
        self.cfg["gpu_agent_token"] = profile.get("gpu_agent_token", "")
        self.apply_server_urls()

    def add_connection_profile(self):
        name, ok = QInputDialog.getText(self, "Новый профиль", "Название:")
        name = name.strip()
        if not ok or not name: return
        if name in self.cfg["connection_profiles"]:
            QMessageBox.warning(self, "Профиль", "Такой профиль уже существует.")
            return
        try:
            profile = {"servers": {"dockhand": self.dock_fields.values(), "openwebui": self.webui_fields.values(), "gpu": self.gpu_fields.values()}, "gpu_agent_token": self.token.text().strip()}
        except ValueError as exc:
            QMessageBox.warning(self, "Проверьте настройки", str(exc))
            return
        self.cfg["connection_profiles"][name] = profile
        self.profile_combo.addItem(name)
        self.profile_combo.setCurrentText(name)
        save_cfg(self.cfg)

    def remove_connection_profile(self):
        name = self.profile_combo.currentText()
        if len(self.cfg["connection_profiles"]) <= 1:
            QMessageBox.information(self, "Профили", "Нельзя удалить последний профиль.")
            return
        if QMessageBox.question(self, "Удалить профиль", "Удалить профиль «" + name + "»?") != QMessageBox.Yes: return
        self.cfg["connection_profiles"].pop(name, None)
        next_name = next(iter(self.cfg["connection_profiles"]))
        self.profile_combo.blockSignals(True)
        self.profile_combo.removeItem(self.profile_combo.currentIndex())
        self.profile_combo.setCurrentText(next_name)
        self.profile_combo.blockSignals(False)
        self.switch_connection_profile(next_name)
        save_cfg(self.cfg)

    def apply_server_urls(self):
        # URLs are loaded only after an explicit selection; do not spawn background browser pages.
        return

    def save_settings(self):
        try:
            self.cfg["servers"] = {"dockhand": self.dock_fields.values(), "openwebui": self.webui_fields.values(), "gpu": self.gpu_fields.values()}
        except ValueError as exc:
            QMessageBox.warning(self, "Проверьте настройки", str(exc))
            return
        proxy_url = self.proxy_url.text().strip()
        if proxy_url and not proxy_url.startswith(("http://", "https://", "socks5://")):
            QMessageBox.warning(self, "Прокси", "Укажите URL прокси с протоколом http://, https:// или socks5://.")
            return
        self.cfg["gpu_agent_token"] = self.token.text().strip()
        self.cfg["proxy_url"] = proxy_url
        self.cfg["active_connection_profile"] = self.profile_combo.currentText()
        self.cfg["connection_profiles"][self.cfg["active_connection_profile"]] = {"servers": self.cfg["servers"], "gpu_agent_token": self.cfg["gpu_agent_token"]}
        try:
            save_cfg(self.cfg)
        except Exception as exc:
            logger.exception("Не удалось сохранить настройки или зашифрованные секреты")
            QMessageBox.critical(self, "Ошибка сохранения", str(exc))
            return
        self.apply_server_urls()
        self.cfg.setdefault("service_last_urls", {}).pop("Open WebUI", None)
        if self.current_service == "Open WebUI": self.select_openwebui()
        QMessageBox.information(self, "AIHub Studio", "Настройки сохранены. Если изменён прокси, перезапустите приложение.")

    def add_ai_tab(self, name, url):
        if name and url:
            self.ai_services_by_name[name] = {"name": name, "url": url}

    def add_service_dialog(self):
        name, ok = QInputDialog.getText(self, "AI-сервис", "Название:")
        if not ok or not name.strip(): return
        url, ok = QInputDialog.getText(self, "AI-сервис", "URL:", text="https://")
        if not ok or not url.startswith(("https://", "http://")): return
        service = {"name": name.strip(), "url": url.strip(), "category": "custom", "pricing": "unknown", "privacy": "unknown", "best_for": []}
        self.ai_catalog.append(service)
        enabled = self.cfg.setdefault("enabled_ai_services", [])
        if service["name"] not in enabled:
            enabled.append(service["name"])
        self.sync_ai_tabs()
        self.populate_ai_catalog()
        save_cfg(self.cfg)

    def proxy_map(self):
        proxy = self.cfg.get("proxy_url", "").strip()
        return {"http": proxy, "https": proxy} if proxy else {}

    def current_ai_view(self):
        return self.chat_view if self.stack.currentWidget() is self.chat_view else None

    def navigate_ai_address(self):
        if self.current_ai_view() is None: return
        value = self.ai_address.text().strip()
        if value and not value.startswith(("http://", "https://")): value = "https://" + value
        if value: self.chat_view.setUrl(QUrl(value))

    def update_ai_address_for(self, view, url):
        if view is self.chat_view and self.stack.currentWidget() is self.chat_view:
            self.ai_address.setText(url.toString())

    def update_ai_address(self, *_):
        self.ai_address.setText(self.chat_view.url().toString())

    def on_service_selected(self, item):
        data = item.data(Qt.UserRole) or {}
        kind = data.get("kind")
        if kind == "heading": return
        requested_name = "Open WebUI" if kind == "openwebui" else data.get("name", "")
        if requested_name == self.current_service:
            self.show_page("chat")
            return
        old_name = self.current_service
        current_url = self.chat_view.url()
        if old_name and old_name != "Dockhand" and old_name != requested_name and current_url.scheme() in ("http", "https"):
            self.cfg.setdefault("service_last_urls", {})[old_name] = current_url.toString()
        self.show_page("chat")
        self.current_service = requested_name
        if kind == "openwebui":
            base_url = server_url(self.cfg["servers"]["openwebui"])
        else:
            base_url = data.get("url", "")
        url = self.cfg.get("service_last_urls", {}).get(self.current_service, base_url)
        self.page_title.setText(self.current_service or "AIHub Studio")
        self.ai_address.setText(url)
        if url and self.chat_view.url().toString() != url:
            self.chat_view.setUrl(QUrl(url))
        logger.info("Выбран сервис: %s", self.current_service)
        save_cfg(self.cfg)

    def select_openwebui(self):
        for row in range(self.service_list.count()):
            item = self.service_list.item(row)
            if (item.data(Qt.UserRole) or {}).get("kind") == "openwebui":
                self.service_list.setCurrentItem(item)
                self.on_service_selected(item)
                return

    def show_page(self, page):
        indexes = {"chat": 0, "overview": 1, "catalog": 2, "settings": 3}
        if page == "dockhand":
            if self.current_service != "Dockhand" and self.current_service and self.chat_view.url().scheme() in ("http", "https"):
                self.cfg.setdefault("service_last_urls", {})[self.current_service] = self.chat_view.url().toString()
            self.stack.setCurrentWidget(self.chat_view)
            url = server_url(self.cfg["servers"]["dockhand"])
            self.current_service = "Dockhand"
            self.page_title.setText("Dockhand")
            self.ai_address.setText(url)
            self.chat_view.setUrl(QUrl(url or "about:blank"))
        elif page in indexes:
            self.stack.setCurrentIndex(indexes[page])
            titles = {"chat": self.current_service, "overview": "Обзор ресурсов", "catalog": "Каталог AI", "settings": "Настройки"}
            self.page_title.setText(titles[page])
            self.ai_address.setVisible(page == "chat")
            self.ai_go.setVisible(page == "chat")
            self.ai_back.setEnabled(page == "chat")
            self.ai_forward.setEnabled(page == "chat")
            self.ai_reload.setEnabled(page == "chat")
        for key, button in self.nav_buttons.items():
            button.setChecked(key == page)
        if page != "chat":
            self.ai_address.setVisible(False)
            self.ai_go.setVisible(False)
        else:
            self.ai_address.setVisible(True)
            self.ai_go.setVisible(True)

    def closeEvent(self, event):
        try:
            if self.current_service and self.current_service != "Dockhand" and self.chat_view.url().scheme() in ("http", "https"):
                self.cfg.setdefault("service_last_urls", {})[self.current_service] = self.chat_view.url().toString()
            save_cfg(self.cfg)
        except Exception:
            logger.exception("Не удалось сохранить состояние перед закрытием")
        super().closeEvent(event)

    def on_service_order_changed(self, *_):
        ordered = []
        for row in range(self.service_list.count()):
            data = self.service_list.item(row).data(Qt.UserRole) or {}
            if data.get("kind") == "service": ordered.append(data.get("name"))
        self.cfg["service_order"] = ordered
        save_cfg(self.cfg)
        logger.info("Порядок AI-сервисов сохранён")

    def refresh(self):
        self.cpu.set(f"{psutil.cpu_percent():.0f}%")
        memory = psutil.virtual_memory()
        self.ram.set(f"{memory.percent:.0f}% · {memory.used / 1024**3:.1f}/{memory.total / 1024**3:.1f} GB")
        gpu_url = server_url(self.cfg["servers"]["gpu"])
        if not gpu_url:
            self.agent.set("Адрес не задан")
            self.gpu_info.setText("Укажите адрес удалённого Linux ROCm Agent в настройках.")
            return
        if self.agent_worker_active: return
        self.agent_worker_active = True
        worker = AgentFetchWorker(gpu_url, self.cfg.get("gpu_agent_token", ""), {})
        self.agent_worker = worker
        worker.signals.finished.connect(self.on_agent_result)
        self.thread_pool.start(worker)

    def on_agent_result(self, payload, error):
        self.agent_worker_active = False
        if error:
            self.agent.set("Нет подключения")
            self.gpu_info.setText("Удалённый агент недоступен. Проверьте адрес, токен и соединение LAN/VPN.")
            self.status.setText("Ошибка связи с GPU Agent")
            if error != self.last_agent_error: logger.warning("Удалённый GPU Agent недоступен: %s", error)
            self.last_agent_error = error
            return
        devices = payload.get("devices", []) if isinstance(payload, dict) else []
        self.agent.set(f"{len(devices)} AMD GPU" if devices else "Агент доступен · нет метрик")
        info = [f"AMD GPU {d.get('index', '—')}: загрузка {d.get('gpu_percent', '—')}% · VRAM {d.get('vram_percent', '—')}% · температура {d.get('temperature_c', '—')}°C · мощность {d.get('power_w', '—')} W" for d in devices]
        self.gpu_info.setText("\\n".join(info) if info else "Агент отвечает, но не вернул данные GPU.")
        self.status.setText("Данные получены от удалённого ROCm Agent")
        if self.last_agent_error is not None: logger.info("Связь с удалённым GPU Agent восстановлена")
        self.last_agent_error = None

# Read the proxy before Chromium starts; QtWebEngine reads this at process startup.
try:
    _bootstrap_cfg = load_cfg()
    _bootstrap_proxy = _bootstrap_cfg.get("proxy_url", "").strip()
    if _bootstrap_proxy:
        _existing_flags = os.environ.get("QTWEBENGINE_CHROMIUM_FLAGS", "").strip()
        os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = (_existing_flags + " --proxy-server=" + _bootstrap_proxy).strip()
except Exception:
    pass

app = QApplication(sys.argv)
app.setStyleSheet("""
QWidget { background:#11151d; color:#e8edf5; font-family:"Segoe UI"; font-size:13px; }
QFrame#sidebar { background:#101722; border-right:1px solid #263244; }
QLabel#brand { color:#f3f6fb; font-size:19px; font-weight:700; padding:4px 2px 14px 2px; }
QLabel#sideCaption { color:#8190a4; font-size:10px; font-weight:700; letter-spacing:1px; padding:8px 4px; }
QFrame#toolbar { background:#141c28; border-bottom:1px solid #273448; }
QLabel#pageTitle { color:#f3f6fb; font-size:17px; font-weight:650; padding-left:10px; }
QLineEdit#addressBar { background:#0d131d; border:1px solid #2b3a50; border-radius:9px; padding:9px 12px; }
QListWidget#serviceList { background:transparent; border:0; padding:2px; outline:0; }
QListWidget#serviceList::item { color:#c0cada; padding:12px 12px; border-radius:9px; margin:1px 0; }
QListWidget#serviceList::item:selected { background:#263d56; color:#ffffff; font-weight:600; }
QListWidget#serviceList::item:hover:!selected { background:#1a2635; }
QPushButton#sideNav { text-align:left; background:transparent; border:0; color:#aab7c8; padding:12px 14px; border-radius:9px; font-weight:500; }
QPushButton#sideNav:hover { background:#1a2635; color:#ffffff; }
QPushButton#sideNav:checked { background:#223c55; color:#ffffff; border:1px solid #345777; }
QPushButton#toolButton { background:#1b293a; border:1px solid #2c4058; padding:8px 12px; border-radius:8px; }
QPushButton#toolButton:hover { background:#2a4058; }
QFrame#sideDivider { color:#273448; max-height:1px; }

QMainWindow { background:#0b0e14; }
QTabWidget::pane { border:1px solid #252d3b; border-radius:12px; top:-1px; background:#111722; }
QTabBar::tab { background:#171e2a; color:#aeb9c9; padding:12px 20px; margin:3px 3px 0 0; border-top-left-radius:9px; border-top-right-radius:9px; }
QTabBar::tab:selected { background:#26364b; color:#ffffff; }
QTabBar::tab:hover:!selected { background:#202b3a; }
QFrame#metric, QGroupBox { background:#171f2c; border:1px solid #2b3749; border-radius:14px; padding:14px; }
QFrame#metric { min-height:105px; }
QLabel#metricValue { font-size:25px; font-weight:700; color:#79dfc3; }
QLabel#heading { font-size:22px; font-weight:700; color:#f2f5fa; }
QLabel#info { background:#171f2c; border:1px solid #2b3749; border-radius:14px; padding:22px; font-size:15px; }
QLineEdit, QComboBox { background:#0f1520; border:1px solid #344257; padding:10px 12px; border-radius:8px; selection-background-color:#426b91; }
QLineEdit:focus, QComboBox:focus { border:1px solid #68a9d8; }
QListWidget { background:#121925; border:1px solid #29364a; border-radius:12px; padding:8px; }
QListWidget::item { padding:10px; border-radius:7px; }
QListWidget::item:selected { background:#29415b; }
QPushButton { background:#2e638e; border:1px solid #3d79a8; padding:10px 16px; border-radius:8px; font-weight:600; }
QPushButton:hover { background:#397bab; }
QPushButton:pressed { background:#234e72; }
QScrollArea { border:0; }
QGroupBox::title { subcontrol-origin:margin; left:12px; padding:0 6px; color:#91b9d7; font-weight:600; }
""")
window = Main()
window.show()
sys.exit(app.exec())
