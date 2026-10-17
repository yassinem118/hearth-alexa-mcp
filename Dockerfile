FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV HOST=0.0.0.0 PORT=3000
# Behind a public URL you MUST set: ALLOWED_ORIGINS=https://your.domain  ALLOWED_HOSTS=your.domain
EXPOSE 3000
CMD ["node", "server.js"]
