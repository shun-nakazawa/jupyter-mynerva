FROM quay.io/jupyter/base-notebook:latest

# Node.js インストール
RUN mamba install -y nodejs=22 && mamba clean -afy

# nblibram バイナリ取得
USER root
RUN ARCH=$(uname -m | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/') && \
    wget -qO- "https://github.com/NII-cloud-operation/nblibram/releases/latest/download/nblibram_linux_${ARCH}.tar.gz" | tar xz -C /usr/local/bin/ nblibram
USER ${NB_UID}

# 依存パッケージのインストール（キャッシュ効率化のため先にコピー）
COPY --chown=${NB_UID}:${NB_GID} package.json yarn.lock* /home/${NB_USER}/jupyter-mynerva/
WORKDIR /home/${NB_USER}/jupyter-mynerva
RUN jlpm install --frozen-lockfile || jlpm install

# プロジェクト全体をコピーしてビルド・インストール
COPY --chown=${NB_UID}:${NB_GID} . /home/${NB_USER}/jupyter-mynerva/
RUN pip install --no-cache-dir -e "." && \
    jupyter labextension develop --overwrite . && \
    jupyter server extension enable jupyter_mynerva

# セッション・設定ディレクトリの作成
RUN mkdir -p /home/${NB_USER}/.mynerva/sessions

# サンプルノートブックをホームに配置
RUN cp -r example/*.ipynb /home/${NB_USER}/ 2>/dev/null || true

WORKDIR /home/${NB_USER}
EXPOSE 8888

CMD ["jupyter", "lab", "--ip=0.0.0.0", "--port=8888", "--no-browser", "--ServerApp.token=''"]
