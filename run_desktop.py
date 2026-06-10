from __future__ import annotations

import socket
import threading
import time
import webbrowser

import uvicorn

from backend.app import app


HOST = "127.0.0.1"
PORT = 5173
URL = f"http://{HOST}:{PORT}"


def wait_for_server() -> None:
    for _ in range(60):
        try:
            with socket.create_connection((HOST, PORT), timeout=0.2):
                webbrowser.open(URL)
                return
        except OSError:
            time.sleep(0.25)


if __name__ == "__main__":
    threading.Thread(target=wait_for_server, daemon=True).start()
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
