# 构建上下文必须是仓库根目录：
#   docker build -f server/Dockerfile -t verity-study .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8787

WORKDIR /app

COPY server/requirements.txt /app/server/requirements.txt
RUN pip install --no-cache-dir -r /app/server/requirements.txt

COPY server /app/server

EXPOSE 8787

CMD ["python", "-m", "server.app"]
