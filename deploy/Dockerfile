# Core Cut ERP — imagem de produção (API Node + interface React já compilada).
# Contexto de build: a raiz do projeto (veja docker-compose.yml).

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
ENV NODE_ENV=production \
    PORT=4400 \
    HOST=0.0.0.0 \
    ARCOPLAN_DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY backend ./backend
COPY shared ./shared
# a API carrega src/domain/automations.ts em tempo de execução (Node remove os tipos)
COPY src ./src
COPY --from=build /app/dist ./dist
# só /data precisa de escrita (arquivos enviados); o código em /app é somente leitura.
# (chown -R /app copiava toda a node_modules numa nova camada e levava ~4 minutos)
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4400
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4400/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "backend/server.mjs"]
