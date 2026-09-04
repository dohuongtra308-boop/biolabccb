"""Flask/WSGI entry point for BioLab Manager.

The existing HTTP handler remains the single source of truth for API behaviour.
This adapter translates Flask requests/responses so the application can run
under a WSGI host such as PythonAnywhere without opening its own TCP server.
"""

from io import BytesIO

from flask import Flask, Response, request

from database import init_db, seed_real_data
from server import BioLabHTTPHandler


app = Flask(__name__, static_folder=None)


class FlaskHandlerAdapter(BioLabHTTPHandler):
    """Run a BioLabHTTPHandler request without a socket connection."""

    def __init__(self):
        # BaseHTTPRequestHandler.__init__ would immediately read from a socket,
        # so the small request/response surface it needs is supplied directly.
        self.path = request.full_path[:-1] if request.full_path.endswith("?") else request.full_path
        self.command = request.method
        self.request_version = request.environ.get("SERVER_PROTOCOL", "HTTP/1.1")
        self.headers = request.headers
        self.rfile = BytesIO(request.get_data(cache=True))
        self.wfile = BytesIO()
        self._status = 200
        self._response_headers = []

    def send_response(self, code, message=None):
        self._status = int(code)

    def send_header(self, keyword, value):
        self._response_headers.append((str(keyword), str(value)))

    def end_headers(self):
        return None

    def send_error(self, code, message=None, explain=None):
        error_message = message or "Yêu cầu không hợp lệ"
        self.send_json({"success": False, "error": error_message}, status=code)

    def to_flask_response(self):
        body = self.wfile.getvalue()
        response = Response(body, status=self._status)
        for name, value in self._response_headers:
            # Werkzeug calculates its own content length reliably.
            if name.lower() != "content-length":
                response.headers[name] = value
        return response


def dispatch_to_existing_handler():
    handler = FlaskHandlerAdapter()
    method = getattr(handler, f"do_{request.method}", None)
    if method is None:
        return Response(
            '{"success": false, "error": "Phương thức không được hỗ trợ"}',
            status=405,
            content_type="application/json; charset=utf-8",
        )
    method()
    return handler.to_flask_response()


@app.route("/", defaults={"requested_path": ""}, methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
@app.route("/<path:requested_path>", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
def wsgi_dispatch(requested_path):
    return dispatch_to_existing_handler()


# WSGI hosts import the module instead of executing it as a script, so schema
# initialization must happen during import. Both functions are restart-safe.
init_db()
seed_real_data()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8080, threaded=True)
