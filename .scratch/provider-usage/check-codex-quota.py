"""Read-only protocol probe: initialize Codex app-server and read quota; no thread/turn creation."""
import json
import os
import queue
import subprocess
import threading
import time

proc = subprocess.Popen(
    [os.environ.get("COMSPEC", "cmd.exe"), "/d", "/c", "codex.cmd app-server"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    text=True, encoding="utf-8", errors="replace",
)
lines = queue.Queue()

def read_lines():
    for line in proc.stdout:
        lines.put(line)
    lines.put(None)

threading.Thread(target=read_lines, daemon=True).start()

def send(payload):
    proc.stdin.write(json.dumps(payload) + "\n")
    proc.stdin.flush()

try:
    send({"id": 1, "method": "initialize", "params": {"clientInfo": {"name": "provider_usage_probe", "title": "Read-only provider usage probe", "version": "0.0.1"}}})
    deadline = time.monotonic() + 30
    while True:
        left = deadline - time.monotonic()
        if left <= 0:
            raise TimeoutError("Codex quota read timed out")
        try:
            line = lines.get(timeout=left)
        except queue.Empty:
            raise TimeoutError("Codex quota read timed out")
        if line is None:
            raise RuntimeError("Codex app-server closed before returning quota")
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if msg.get("id") == 1:
            if "error" in msg:
                raise RuntimeError("Codex initialize failed: " + json.dumps(msg["error"]))
            send({"method": "initialized"})
            send({"id": 2, "method": "account/rateLimits/read"})
        elif msg.get("id") == 2:
            if "error" in msg:
                raise RuntimeError("Codex quota read failed: " + json.dumps(msg["error"]))
            print(json.dumps({"quota": msg.get("result")}, indent=2))
            break
finally:
    subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)
