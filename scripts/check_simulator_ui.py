"""Run the simulator integration checks in installed Chrome, with no dependencies."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Event, Thread
import argparse
import re
import subprocess
import tempfile
import html

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", default=r"C:\Program Files\Google\Chrome\Application\chrome.exe")
    parser.add_argument("--page", default="tests/simulator-ui.browser.html")
    parser.add_argument("--screenshot", help="Optional screenshot output path")
    parser.add_argument("--window-size", default="1200,1000")
    parser.add_argument("--reduced-motion", action="store_true", help="Emulate reduced-motion preference")
    parser.add_argument("--real-time", action="store_true", help="Wait for a posted browser report without virtual time (scroll tests)")
    args = parser.parse_args()
    requests = []
    report_ready = Event()
    posted_reports = []

    class Handler(SimpleHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            requests.append(self.path)
            super().do_GET()

        def do_POST(self):
            if self.path != "/__browser_report":
                self.send_error(404)
                return
            posted_reports.append(self.rfile.read(int(self.headers["Content-Length"])).decode("utf-8"))
            self.send_response(204)
            self.end_headers()
            report_ready.set()

    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with tempfile.TemporaryDirectory(prefix="lumen-browser-check-") as profile:
            command = [args.browser, "--headless", "--disable-gpu", "--no-first-run",
                 "--no-default-browser-check", f"--user-data-dir={profile}",
                 f"--window-size={args.window_size}",
                 *(["--force-prefers-reduced-motion"] if args.reduced_motion else []),
                 *([] if args.real_time else ["--dump-dom", "--virtual-time-budget=15000"]),
                 *([f"--screenshot={Path(args.screenshot).resolve()}"] if args.screenshot and not args.real_time else []),
                 f"http://127.0.0.1:{server.server_port}/{args.page}"]
            if args.real_time:
                with subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) as browser:
                    try:
                        report_ready.wait(30)
                        report = posted_reports[0] if posted_reports else "FAIL: No browser report"
                    finally:
                        browser.terminate()
                        browser.wait(timeout=10)
                return_code = 0
            else:
                result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
                match = re.search(r'<pre id="report"[^>]*>(.*?)</pre>', result.stdout, re.S)
                report = html.unescape(match.group(1)) if match else "FAIL: No browser report"
                return_code = result.returncode
            print(report)
            data_requests = [path for path in requests if path.startswith("/data/")]
            assert data_requests and all(path.startswith("/data/app_data/") for path in data_requests), "Unexpected data request"
            print("PASS: All browser data requests use /data/app_data/")
            if return_code or not report.startswith("PASS:"):
                raise SystemExit(1)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
