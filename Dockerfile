FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Etc/UTC

# Install minimal system packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    wget \
    tzdata \
    bzip2 \
    git \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Miniconda
ENV CONDA_DIR=/opt/conda
ENV PATH=$CONDA_DIR/bin:$PATH

RUN wget --quiet https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -O /tmp/miniconda.sh && \
    bash /tmp/miniconda.sh -b -p $CONDA_DIR && \
    rm /tmp/miniconda.sh && \
    conda clean -afy

# Configure Conda to avoid Terms of Service error (SYSTEM-WIDE)
RUN conda config --system --remove-key channels || true && \
    conda config --system --add channels conda-forge && \
    conda config --system --set channel_priority strict && \
    conda config --system --set always_yes yes && \
    conda config --system --set auto_activate_base false
    

# Install mamba into base env (now it will work)
RUN conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/main
RUN conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/r

RUN conda install -n base mamba

# Set working directory
WORKDIR /app

COPY env.yml /app/env.yml

RUN conda init

# Create the environment (taxalin)
RUN conda env create -f env.yml && \
    conda clean -afy

RUN mamba run -n taxalin mamba install -c conda-forge boost=1.85 -y

COPY . /app


RUN conda init bash

# Append env activation to bash startup
RUN echo "conda activate taxalin" >> /root/.bashrc

# Activate the environment for all future shell commands
SHELL ["conda", "run", "-n", "taxalin", "/bin/bash", "-c"]

CMD ["bash"]
