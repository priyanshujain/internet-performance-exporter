FROM node:24-alpine
RUN apk add --no-cache chromium
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js ./
ENV CHROMIUM_PATH=/usr/bin/chromium
USER node
EXPOSE 9798
CMD ["npm", "start"]
