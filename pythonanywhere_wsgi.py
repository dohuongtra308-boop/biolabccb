"""WSGI configuration for the nghe486443 PythonAnywhere account.

Copy the contents of this file into the WSGI configuration file shown on the
PythonAnywhere Web tab.
"""

import os
import sys


PROJECT_DIR = "/home/nghe486443/biolab"

if PROJECT_DIR not in sys.path:
    sys.path.insert(0, PROJECT_DIR)

# Keep SQLite at an explicit persistent location in the account home folder.
os.environ["BIOLAB_DB_FILE"] = os.path.join(PROJECT_DIR, "biolab.db")

from app import app as application  # noqa: E402
