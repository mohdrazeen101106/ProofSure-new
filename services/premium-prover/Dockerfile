# Backend prover service -- production container
#
# Build:  docker build -t premium-prover-backend .
# Run:    docker run -p 8000:8000 premium-prover-backend
#
# For real throughput, run multiple containers behind a load balancer / job
# queue rather than raising --workers on a single container: each ezkl
# proving call is CPU-bound and the app.py PROVE_LOCK serializes them within
# one process on purpose (see the comment above PROVE_LOCK in app.py).
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
COPY artifacts/ artifacts/
COPY ezkl_workspace/ ezkl_workspace/

EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
