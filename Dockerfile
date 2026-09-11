FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache git
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY tests ./tests
RUN npm run build
RUN npm test

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache git
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["npm","start"]
