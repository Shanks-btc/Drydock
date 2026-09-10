# Drydock backend — Node + Python in one image.
#
# Python is a RUNTIME dependency, not just a build tool: src/memory/sibylBridge.ts
# spawns `python3` per call to run src/memory/sibyl_bridge.py against
# sibyl-memory-client (Python-only SDK, no Node binding). A plain Nixpacks Node
# build would not provision Python, so this project builds from a Dockerfile.
#
# Node 24 matches the dev environment and supports `--experimental-transform-types`
# (used by `npm start` to run the .ts entrypoint with no build step).

FROM node:24-bookworm-slim

# Python 3.11 (Debian bookworm) + pip. sibyl-memory-client needs >=3.10.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Node deps (runtime only) ---------------------------------------------
# devDependencies are @types/* (compile-time only; --experimental-transform-types
# strips types without resolving them) and playwright (test scripts only).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- Python deps ---------------------------------------------------------
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

# --- App source --------------------------------------------------------
COPY src ./src

ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    PYTHONUTF8=1 \
    SIBYL_PYTHON_BIN=python3

# App reads $PORT (Railway injects it); 3000 is just the local default.
EXPOSE 3000
CMD ["npm", "start"]
