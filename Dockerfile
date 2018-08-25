FROM node:alpine
WORKDIR '/app'
COPY package.json .
RUN npm run setup
COPY . .
RUN npm run build

FROM nginx
COPY --from=builder /client/build /usr/share/nginx/html
