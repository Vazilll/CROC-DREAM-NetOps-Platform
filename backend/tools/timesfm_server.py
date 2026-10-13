"""Local TimesFM forecasting service (stdlib HTTP, torch lives only in this process).

    C:\\vazus\\.venv\\Scripts\\python.exe backend/tools/timesfm_server.py --model C:\\vazus\\data\\models\\timesfm3

POST /forecast  {"series": [...], "horizon": 72}
             -> {"median": [...], "lower": [...], "upper": [...], "provider": "..."}
Quantile band: 10% .. 90%.
"""

from __future__ import annotations

import argparse
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from timesfm3 import TimesFM3Forecaster

parser = argparse.ArgumentParser()
parser.add_argument("--model", default="google/timesfm-3.0-pytorch", help="local dir or HF repo id")
parser.add_argument("--port", type=int, default=8100)
args = parser.parse_args()

model = TimesFM3Forecaster.from_pretrained(args.model, local_files_only=not args.model.startswith("google/"))
lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        if self.path == "/forecast":

            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            with lock:
                out = model.predict(np.asarray(payload["series"], dtype=np.float32), int(payload["horizon"]), return_quantiles=True)
            q = out.quantiles
            body = json.dumps(
                {
                    "median": out.forecast.tolist(),
                    "lower": q[:, 0].tolist(),
                    "upper": q[:, -1].tolist(),
                    "provider": "Google TimesFM 3.0 (local)",
                }
            ).encode()
        elif self.path == "/detect_anomaly":
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            history = np.asarray(payload["history"], dtype=np.float32)
            actual = np.asarray(payload["actual"], dtype=np.float32)
            horizon = max(len(actual), 1)
            with lock:
                out = model.predict(history, horizon, return_quantiles=True)
            q = out.quantiles
            lower = q[:len(actual), 0]
            upper = q[:len(actual), -1]
            median = out.forecast[:len(actual)]

            is_drop = bool(np.any((actual < lower * 0.4) & (lower > 5.0)))
            is_spike = bool(np.any((actual > upper * 1.5) | (actual >= 90.0)))
            is_anomaly = is_drop or is_spike
            anomaly_type = "drop" if is_drop else ("spike" if is_spike else "none")

            body = json.dumps(
                {
                    "is_anomaly": is_anomaly,
                    "anomaly_type": anomaly_type,
                    "median": median.tolist(),
                    "lower": lower.tolist(),
                    "upper": upper.tolist(),
                    "provider": "Google TimesFM 3.0 (local anomaly detector)",
                }
            ).encode()
        else:
            self.send_error(404)
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_: object) -> None:
        pass


if __name__ == "__main__":
    print(f"TimesFM ready on http://127.0.0.1:{args.port}/forecast")
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
