FROM postgres:16-alpine

WORKDIR /workspace
COPY migrations /workspace/migrations
COPY scripts /workspace/scripts
RUN chmod +x /workspace/scripts/apply-migrations.sh

ENTRYPOINT ["sh", "/workspace/scripts/apply-migrations.sh"]
