import sys, os, json, subprocess
from pathlib import Path

import psutil
import requests
from PySide6.QtCore import QTimer, QUrl
from PySide6.QtWidgets import QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QLineEdit, QTabWidget, QFrame, QGridLayout, QMessageBox, QInputDialog
from PySide6.QtWebEngineWidgets import QWebEngineView

CONFIG_DIR = Path(os.environ.get("APPDATA", str(Path.home()))) / "AIHubStudio"
CONFIG_DIR.mkdir(parents=True, exist_ok=True)
CFG = CONFIG_DIR / "settings.json"
DEFAULTS = {
    "dockhand_url": "https://dh.forsage.netcraze.link",
    "gpu_agent_url": "http://SERVER_VPN_IP:8765",
    "gpu_agent_token": "",
    "ai_services": [
        {"name": "Open WebUI", "url": "https://ai.forsage.netcraze.link/"},
        {"name": "ChatGPT", "url": "https://chatgpt.com"},
        {"name": "Claude", "url": "https://claude.ai"},
        {"name": "Gemini", "url": "https://gemini.google.com"},
        {"name": "OpenRouter", "url": "https://openrouter.ai"}
    ]
}

def load_cfg():
    try:
        return {**DEFAULTS, **json.loads(CFG.read_text(encoding="utf-8"))}
    except Exception:
        return DEFAULTS.copy()

def save_cfg(cfg):
    CFG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")

def nvidia_stats():
    try:
        p = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3
        )
        if p.returncode:
            return []
        rows = []
        for i, line in enumerate(p.stdout.splitlines()):
            c = [x.strip() for x in line.split(",")]
            if len(c) >= 6:
                def num(x):
                    try:
                        return float(x)
                    except ValueError:
                        return None
                rows.append({"name": c[0], "gpu_percent": num(c[1]), "vram_used_mb": num(c[2]), "vram_total_mb": num(c[3]), "temperature_c": num(c[4]), "power_w": num(c[5]), "index": i})
        return rows
    except Exception:
        return []

class Metric(QFrame):
    def __init__(self, title):
        super().__init__()
        self.setObjectName("metric")
        layout = QVBoxLayout(self)
        self.title = QLabel(title)
        self.value = QLabel("—")
        self.value.setObjectName("metricValue")
        layout.addWidget(self.title)
        layout.addWidget(self.value)

    def set(self, value):
        self.value.setText(str(value))

class Main(QMainWindow):
    def __init__(self):
        super().__init__()
        self.cfg = load_cfg()
        self.setWindowTitle("AIHub Studio")
        self.resize(1440, 900)
        self.tabs = QTabWidget()
        self.setCentralWidget(self.tabs)
        self.dashboard = self.make_dashboard()
        self.tabs.addTab(self.dashboard, "Обзор")
        self.ai_tabs = QTabWidget()
        self.tabs.addTab(self.ai_tabs, "AI Hub")
        for item in self.cfg["ai_services"]:
            self.add_ai_tab(item["name"], item["url"])
        self.dock = QWebEngineView()
        self.tabs.addTab(self.dock, "Docker · Dockhand")
        self.dock.setUrl(QUrl(self.cfg["dockhand_url"]))
        self.settings = self.make_settings()
        self.tabs.addTab(self.settings, "Настройки")
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
        self.cpu = Metric("CPU")
        self.ram = Metric("RAM")
        self.gpu = Metric("GPU / NVIDIA")
        self.agent = Metric("AMD ROCm agent")
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
        widget = QWidget()
        layout = QVBoxLayout(widget)
        layout.addWidget(QLabel("Подключения"))
        self.dock_url = QLineEdit(self.cfg["dockhand_url"])
        self.agent_url = QLineEdit(self.cfg["gpu_agent_url"])
        self.token = QLineEdit(self.cfg["gpu_agent_token"])
        self.token.setEchoMode(QLineEdit.Password)
        for label, field in [("Dockhand URL", self.dock_url), ("Linux ROCm agent URL", self.agent_url), ("Agent bearer token", self.token)]:
            layout.addWidget(QLabel(label))
            layout.addWidget(field)
        save_button = QPushButton("Сохранить подключения")
        save_button.clicked.connect(self.save_settings)
        layout.addWidget(save_button)
        add_button = QPushButton("Добавить AI-сервис")
        add_button.clicked.connect(self.add_service_dialog)
        layout.addWidget(add_button)
        note = QLabel("Для MI50 используйте Linux ROCm agent на сервере с картой. Токен обязателен. Не публикуйте агент в интернете; используйте LAN/VPN.")
        note.setWordWrap(True)
        layout.addWidget(note)
        layout.addStretch()
        return widget

    def save_settings(self):
        self.cfg.update({"dockhand_url": self.dock_url.text().strip(), "gpu_agent_url": self.agent_url.text().strip(), "gpu_agent_token": self.token.text().strip()})
        save_cfg(self.cfg)
        self.dock.setUrl(QUrl(self.cfg["dockhand_url"]))
        QMessageBox.information(self, "AIHub Studio", "Настройки сохранены.")

    def add_ai_tab(self, name, url):
        view = QWebEngineView()
        view.setUrl(QUrl(url))
        self.ai_tabs.addTab(view, name)

    def add_service_dialog(self):
        name, ok = QInputDialog.getText(self, "AI-сервис", "Название:")
        if not ok or not name.strip():
            return
        url, ok = QInputDialog.getText(self, "AI-сервис", "URL:", text="https://")
        if not ok or not url.startswith(("https://", "http://")):
            return
        self.cfg["ai_services"].append({"name": name.strip(), "url": url.strip()})
        save_cfg(self.cfg)
        self.add_ai_tab(name.strip(), url.strip())

    def refresh(self):
        self.cpu.set(f"{psutil.cpu_percent():.0f}%")
        mem = psutil.virtual_memory()
        self.ram.set(f"{mem.percent:.0f}% · {mem.used / 1024**3:.1f}/{mem.total / 1024**3:.1f} GB")
        ng = nvidia_stats()
        if ng:
            self.gpu.set(f"{ng[0]['gpu_percent']}%")
            self.gpu_info.setText("\n".join(f"{x['name']}: GPU {x['gpu_percent']}% · VRAM {x['vram_used_mb']}/{x['vram_total_mb']} MB · {x['temperature_c']}°C · {x['power_w']} W" for x in ng))
        else:
            self.gpu.set("NVIDIA не обнаружена")
        try:
            url = self.cfg["gpu_agent_url"].rstrip("/") + "/gpu"
            response = requests.get(url, headers={"Authorization": "Bearer " + self.cfg["gpu_agent_token"]}, timeout=2)
            response.raise_for_status()
            devices = response.json().get("devices", [])
            self.agent.set(f"{len(devices)} AMD GPU" if devices else "Агент подключён; метрики не распознаны")
            if devices:
                details = [f"AMD GPU {d.get('index')}: GPU {d.get('gpu_percent', '—')}% · VRAM {d.get('vram_percent', '—')}% · {d.get('temperature_c', '—')}°C · {d.get('power_w', '—')} W" for d in devices]
                self.gpu_info.setText(self.gpu_info.text() + "\n" + "\n".join(details))
        except Exception:
            self.agent.set("Нет подключения")
        self.status.setText("Опрос выполнен")

app = QApplication(sys.argv)
app.setStyleSheet("""
QWidget { background:#10141c; color:#e7edf7; font-size:13px; }
QMainWindow { background:#0b0f16; }
QTabWidget::pane { border:1px solid #263244; }
QTabBar::tab { background:#171e2b; padding:12px 18px; margin:2px; }
QTabBar::tab:selected { background:#26364d; }
QFrame#metric { background:#171f2d; border:1px solid #29384d; border-radius:10px; padding:12px; min-height:90px; }
QLabel#metricValue { font-size:22px; font-weight:600; color:#79d6bd; }
QLabel#heading { font-size:20px; font-weight:700; }
QLabel#info { background:#171f2d; border-radius:10px; padding:18px; font-size:15px; }
QLineEdit { background:#171f2d; border:1px solid #34445b; padding:10px; border-radius:6px; }
QPushButton { background:#315d85; border:0; padding:10px 16px; border-radius:6px; }
QPushButton:hover { background:#4076a6; }
""")
window = Main()
window.show()
sys.exit(app.exec())
