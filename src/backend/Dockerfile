FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1

RUN pip install uv -i https://pypi.tuna.tsinghua.edu.cn/simple/

COPY src/backend/pyproject.toml src/backend/uv.lock ./
RUN UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple/ uv sync --frozen --no-dev

COPY src/backend/app ./app

RUN mkdir -p /app/data /app/uploads

EXPOSE 8000

CMD ["/app/.venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
