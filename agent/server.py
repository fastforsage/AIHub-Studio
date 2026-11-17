import os, json, subprocess, re
from fastapi import FastAPI, Header, HTTPException

app = FastAPI(title="AIHub Studio GPU Agent")
TOKEN = os.environ.get("GPU_AGENT_TOKEN", "")

def run(cmd):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        return p.stdout.strip(), p.returncode
    except Exception:
        return "", 1

def parse_rocm_json():
    for cmd in (["rocm-smi", "--json"], ["rocm-smi", "--showuse", "--showmeminfo", "vram", "--showtemp", "--showpower", "--json"]):
        out, rc = run(cmd)
        if rc == 0 and out:
            try:
                return json.loads(out)
            except Exception:
                pass
    return None

def parse_text():
    out, _ = run(["rocm-smi"])
    result = []
    for line in out.splitlines():
        m = re.search(r"^\\s*(\\d+)\\s+\\d+\\s+0x[0-9a-fA-F]+.*?(\\d+(?:\\.\\d+)?)°C\\s+(\\d+(?:\\.\\d+)?)W.*?(\\d+)%\\s+(\\d+)%\\s*$", line)
        if m:
            result.append({"index": int(m.group(1)), "temperature_c": float(m.group(2)), "power_w": float(m.group(3)), "vram_percent": float(m.group(4)), "gpu_percent": float(m.group(5))})
    return result

@app.get("/health")
def health():
    return {"ok": True, "service": "AIHub Studio GPU Agent"}

@app.get("/gpu")
def gpu(authorization: str | None = Header(default=None)):
    if not TOKEN or authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")
    data = parse_rocm_json()
    devices = parse_text()
    return {"vendor": "AMD", "source": "rocm-smi", "devices": devices, "raw": data, "note": "If devices is empty, inspect raw output / rocm-smi version."}
