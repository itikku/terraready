"""Opt-in camera exporter bridge. Default `make api` remains a disconnected demo."""

import os
from pathlib import Path

from fastapi import FastAPI
from terraready.camera_folder import FolderCameraProvider
from terraready.main import create_app


def create() -> FastAPI:
    root = os.environ.get("TERRAREADY_CAMERA_DIR")
    if not root:
        raise ValueError("Set TERRAREADY_CAMERA_DIR to the camera export directory")
    return create_app(camera_provider=FolderCameraProvider(Path(root)))
