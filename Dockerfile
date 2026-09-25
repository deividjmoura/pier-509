# Imagem de produção do Pier 509: build do front + API Node com dist/.
# Duas etapas para a imagem final levar só o necessário (sem vite/tailwind).

FROM node:22-bookworm-slim AS build
WORKDIR /app

# Camada de dependências (muda pouco → cache bom)
COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Só dependências de produção (sharp é necessário no runtime)
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY server.js index.html ./
COPY db ./db
COPY data ./data
COPY public ./public
COPY scripts ./scripts

# public/uploads fica fora do Git; cria com o usuário da imagem
RUN mkdir -p public/uploads && chown -R node:node /app
USER node

ENV PORT=3000
EXPOSE 3000

# A plataforma também pode usar /healthz direto (Railway/Render/K8s)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `node server.js` roda as migrations pendentes no boot e sobe API + UI na mesma porta.
CMD ["node", "server.js"]
