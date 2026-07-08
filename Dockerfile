FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Etc/UTC

# Install system packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates wget tzdata bzip2 git \
    build-essential gcc g++ \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Miniconda (auto-detect architecture)
ENV CONDA_DIR=/opt/conda
ENV PATH=$CONDA_DIR/bin:$PATH

RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then \
        URL="https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-aarch64.sh"; \
    else \
        URL="https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh"; \
    fi && \
    wget --quiet "$URL" -O /tmp/miniconda.sh && \
    bash /tmp/miniconda.sh -b -p $CONDA_DIR && \
    rm /tmp/miniconda.sh && conda clean -afy

# Configure Conda
RUN conda config --system --add channels conda-forge && \
    conda config --system --set channel_priority strict && \
    conda config --system --set always_yes yes
RUN conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/main || true
RUN conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/r || true
RUN conda install -n base mamba

# Create Python environment (only rebuilds when env.yml changes)
WORKDIR /app
COPY env.yml /app/env.yml
RUN conda env create -f env.yml && conda clean -afy

# Install Node deps (only rebuilds when package*.json change)
WORKDIR /app/ui
COPY src/ui/package.json src/ui/package-lock.json ./
COPY src/ui/taxonium_component/package.json ./taxonium_component/
COPY src/ui/taxonium_data_handling/package.json ./taxonium_data_handling/
COPY src/ui/taxonium_backend/package.json ./taxonium_backend/
RUN npm install && \
    cd taxonium_component && npm install && \
    cd ../taxonium_data_handling && npm install && \
    cd ../taxonium_backend && npm install

# Copy the autolin Python scripts, then the UI source, then build. The scripts must
# be present before the build: npm run build's prebuild hook (sync-autolin-assets)
# syncs propose_sublineages.py into the WASM assets from ../autolin. Only the scripts
# are needed at runtime — the example data files alongside them are left out to keep
# the image small.
COPY src/autolin/*.py /app/autolin/
COPY src/ui /app/ui
RUN NODE_OPTIONS="--max-old-space-size=8192" npm run build

WORKDIR /app

RUN mkdir -p /data

# Single-origin: only the frontend port is exposed. The backend runs internally
# and vite reverse-proxies API calls to it (BACKEND_PORT, overridable at runtime
# with `docker run -e BACKEND_PORT=...`). Remap the app freely with `-p 8080:3000`.
ENV BACKEND_PORT=8001
EXPOSE 3000

# Setup shell
RUN conda init bash && echo "conda activate taxalin" >> /root/.bashrc
SHELL ["/bin/bash", "-c"]

# Set Node.js memory limit for large trees
ENV NODE_OPTIONS="--max-old-space-size=8192"

# Create start script for the launcher workflow
RUN printf '#!/bin/bash\n\
source /opt/conda/etc/profile.d/conda.sh\n\
conda activate taxalin\n\
\n\
echo ""\n\
echo "🧬 Linolium"\n\
echo ""\n\
\n\
# Start backend server in launcher mode (no data file)\n\
cd /app/ui/taxonium_backend\n\
echo "🔌 Starting backend on port ${BACKEND_PORT:-8001}..."\n\
node server.js --port ${BACKEND_PORT:-8001} &\n\
BACKEND_PID=$!\n\
\n\
# Wait for backend to initialize\n\
echo "Waiting for backend to initialize..."\n\
sleep 2\n\
\n\
# Start frontend server\n\
cd /app/ui\n\
echo "🌐 Starting frontend on port 3000..."\n\
npx vite preview --port 3000 --host 0.0.0.0 &\n\
FRONTEND_PID=$!\n\
\n\
echo ""\n\
echo "✨ Ready!"\n\
echo "🌐 Open http://localhost:3000 in your browser"\n\
echo "📂 Upload a .pb file to begin"\n\
echo ""\n\
\n\
# Wait for either process to exit\n\
wait\n\
' > /opt/start.sh && chmod +x /opt/start.sh

CMD ["/opt/start.sh"]
