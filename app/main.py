import sys, os, json, subprocess
from pathlib import Path
from urllib.parse import urlsplit

import psutil
import requests
from PySide6.QtCore import QTimer, QUrl, QRunnable, QThreadPool, QObject, Signal
from PySide6.QtWidgets import QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QLineEdit, QTabWidget, QFrame, QGridLayout, QMessageBox, QInputDialog, QComboBox, QFormLayout, QGroupBox, QScrollArea
from PySide6.QtWebEngineWidgets import QWebEngineView

CONFIG_DIR = Path(os.environ.get("APPDATA", str(Path.home()))) / "AIHubStudio"
CONFIG_DIR.mkdir(parents=True, exist_ok=True)
CFG = CONFIG_DIR / "settings.json"
DEFAULTS = {
    "servers": {
        "dockhand": {"scheme": "https", "host": "", "port": 443, "path": ""},
        "openwebui": {"scheme": "https", "host": "", "port": 443, "path": ""},
        "gpu": {"scheme": "http", "host": "", "port": 8765, "path": ""}
    },
    "gpu_agent_token": "",
    "active_connection_profile": "Локальная сеть",
    "connection_profiles": {},
    "ai_services": [
        {"name": "ChatGPT", "url": "https://chatgpt.com"},
        {"name": "Claude", "url": "https://claude.ai"},
        {"name": "Gemini", "url": "https://gemini.google.com"},
        {"name": "OpenRouter", "url": "https://openrouter.ai"}
    ]
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
    return cfg

def save_cfg(cfg):
    clean = {k: v for k, v in cfg.items() if k not in ("dockhand_url", "gpu_agent_url")}
    clean["ai_services"] = [x for x in clean.get("ai_services", []) if x.get("name", "").lower() != "open webui"]
    active = clean.get("active_connection_profile", "Локальная сеть")
    profiles = clean.setdefault("connection_profiles", {})
    profiles[active] = {"servers": clean.get("servers", {}), "gpu_agent_token": clean.get("gpu_agent_token", "")}
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

def nvidia_stats():
    try:
        p = subprocess.run(["nvidia-smi", "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw", "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=3)
        if p.returncode:
            return []
        rows = []
        for i, line in enumerate(p.stdout.splitlines()):
            c = [x.strip() for x in line.split(",")]
            if len(c) >= 6:
                def num(x):
                    try: return float(x)
                    except ValueError: return None
                rows.append({"name": c[0], "gpu_percent": num(c[1]), "vram_used_mb": num(c[2]), "vram_total_mb": num(c[3]), "temperature_c": num(c[4]), "power_w": num(c[5]), "index": i})
        return rows
    except Exception:
        return []

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
    def __init__(self, url, token=""):
        super().__init__()
        self.url, self.token = url, token
        self.signals = CheckSignals()
    def run(self):
        try:
            headers = {"Authorization": "Bearer " + self.token} if self.token else {}
            response = requests.get(self.url, headers=headers, timeout=(3, 5), stream=True)
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

class Main(QMainWindow):
    def __init__(self):
        super().__init__()
        self.cfg = load_cfg()
        self.thread_pool = QThreadPool.globalInstance()
        self.check_workers = []
        self.setWindowTitle("AIHub Studio")
        self.resize(1440, 900)
        self.tabs = QTabWidget()
        self.setCentralWidget(self.tabs)
        self.tabs.addTab(self.make_dashboard(), "Обзор")
        self.ai_tabs = QTabWidget()
        self.tabs.addTab(self.ai_tabs, "AI Hub")
        self.openwebui_view = QWebEngineView()
        self.ai_tabs.addTab(self.openwebui_view, "Open WebUI")
        for item in self.cfg["ai_services"]:
            self.add_ai_tab(item["name"], item["url"])
        self.dock = QWebEngineView()
        self.tabs.addTab(self.dock, "Docker · Dockhand")
        self.tabs.addTab(self.make_settings(), "Настройки")
        self.apply_server_urls()
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.refresh)
        self.timer.start(3000)
        self.refresh()

    def make_dashboard(self):
        widget = QWidget()
        outer = QVBoxLayout(widget)
        header = QHBoxLayout()
        title = QLabel("СИСТЕМА / МОНИТОРИНГ")
        title.setObjectName("heading")
        header.addWidget(title)
        header.addStretch()
        self.status = QLabel("Опрос каждые 3 сек.")
        header.addWidget(self.status)
        outer.addLayout(header)
        grid = QGridLayout()
        self.cpu, self.ram, self.gpu, self.agent = Metric("CPU"), Metric("RAM"), Metric("GPU / NVIDIA"), Metric("AMD ROCm agent")
        for i, metric in enumerate([self.cpu, self.ram, self.gpu, self.agent]):
            grid.addWidget(metric, 0, i)
        outer.addLayout(grid)
        self.gpu_info = QLabel("GPU устройства появятся после опроса.")
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
        self.gpu_fields = ServerFields("GPU мониторинг · Linux ROCm Agent", self.cfg["servers"]["gpu"])
        layout.addWidget(self.server_check_row(self.dock_fields, "dockhand", "Dockhand"))
        layout.addWidget(self.server_check_row(self.webui_fields, "openwebui", "Open WebUI"))
        layout.addWidget(self.server_check_row(self.gpu_fields, "gpu", "GPU Agent"))
        token_form = QFormLayout()
        self.token = QLineEdit(self.cfg.get("gpu_agent_token", ""))
        self.token.setEchoMode(QLineEdit.Password)
        self.token.setPlaceholderText("Bearer token для GPU Agent")
        token_form.addRow("GPU Agent token", self.token)
        layout.addLayout(token_form)
        save_button = QPushButton("Сохранить подключения")
        save_button.clicked.connect(self.save_settings)
        layout.addWidget(save_button)
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
        worker = ConnectionCheck(url, token)
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
        dock_url = server_url(self.cfg["servers"]["dockhand"])
        webui_url = server_url(self.cfg["servers"]["openwebui"])
        self.dock.setUrl(QUrl(dock_url or "about:blank"))
        self.openwebui_view.setUrl(QUrl(webui_url or "about:blank"))

    def save_settings(self):
        try:
            self.cfg["servers"] = {"dockhand": self.dock_fields.values(), "openwebui": self.webui_fields.values(), "gpu": self.gpu_fields.values()}
        except ValueError as exc:
            QMessageBox.warning(self, "Проверьте настройки", str(exc))
            return
        self.cfg["gpu_agent_token"] = self.token.text().strip()
        self.cfg["active_connection_profile"] = self.profile_combo.currentText()
        self.cfg["connection_profiles"][self.cfg["active_connection_profile"]] = {"servers": self.cfg["servers"], "gpu_agent_token": self.cfg["gpu_agent_token"]}
        save_cfg(self.cfg)
        self.apply_server_urls()
        QMessageBox.information(self, "AIHub Studio", "Настройки сохранены.")

    def add_ai_tab(self, name, url):
        view = QWebEngineView()
        view.setUrl(QUrl(url))
        self.ai_tabs.addTab(view, name)

    def add_service_dialog(self):
        name, ok = QInputDialog.getText(self, "AI-сервис", "Название:")
        if not ok or not name.strip(): return
        url, ok = QInputDialog.getText(self, "AI-сервис", "URL:", text="https://")
        if not ok or not url.startswith(("https://", "http://")): return
        self.cfg["ai_services"].append({"name": name.strip(), "url": url.strip()})
        save_cfg(self.cfg)
        self.add_ai_tab(name.strip(), url.strip())

    def refresh(self):
        self.cpu.set(f"{psutil.cpu_percent():.0f}%")
        mem = psutil.virtual_memory()
        self.ram.set(f"{mem.percent:.0f}% · {mem.used / 1024**3:.1f}/{mem.total / 1024**3:.1f} GB")
        ng = nvidia_stats()
        info = []
        if ng:
            self.gpu.set(f"{ng[0]['gpu_percent']}%")
            info.extend(f"{x['name']}: GPU {x['gpu_percent']}% · VRAM {x['vram_used_mb']}/{x['vram_total_mb']} MB · {x['temperature_c']}°C · {x['power_w']} W" for x in ng)
        else:
            self.gpu.set("NVIDIA не обнаружена")
        gpu_url = server_url(self.cfg["servers"]["gpu"])
        if not gpu_url:
            self.agent.set("Адрес не задан")
        else:
            try:
                response = requests.get(gpu_url.rstrip("/") + "/gpu", headers={"Authorization": "Bearer " + self.cfg.get("gpu_agent_token", "")}, timeout=2)
                response.raise_for_status()
                devices = response.json().get("devices", [])
                self.agent.set(f"{len(devices)} AMD GPU" if devices else "Агент доступен; нет распознанных метрик")
                info.extend(f"AMD GPU {d.get('index')}: GPU {d.get('gpu_percent', '—')}% · VRAM {d.get('vram_percent', '—')}% · {d.get('temperature_c', '—')}°C · {d.get('power_w', '—')} W" for d in devices)
            except Exception:
                self.agent.set("Нет подключения")
        self.gpu_info.setText("\n".join(info) if info else "Нет данных GPU. Проверьте драйверы и настройки удалённого агента.")
        self.status.setText("Опрос выполнен")

app = QApplication(sys.argv)
app.setStyleSheet("""
QWidget { background:#10141c; color:#e7edf7; font-size:13px; }
QMainWindow { background:#0b0f16; }
QTabWidget::pane { border:1px solid #263244; }
QTabBar::tab { background:#171e2b; padding:12px 18px; margin:2px; }
QTabBar::tab:selected { background:#26364d; }
QFrame#metric, QGroupBox { background:#171f2d; border:1px solid #29384d; border-radius:10px; padding:12px; }
QFrame#metric { min-height:90px; }
QLabel#metricValue { font-size:22px; font-weight:600; color:#79d6bd; }
QLabel#heading { font-size:20px; font-weight:700; }
QLabel#info { background:#171f2d; border-radius:10px; padding:18px; font-size:15px; }
QLineEdit, QComboBox { background:#171f2d; border:1px solid #34445b; padding:9px; border-radius:6px; }
QPushButton { background:#315d85; border:0; padding:10px 16px; border-radius:6px; }
QPushButton:hover { background:#4076a6; }
""")
window = Main()
window.show()
sys.exit(app.exec())
