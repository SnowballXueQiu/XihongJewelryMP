FROM nginx:1.27-alpine

COPY deploy/ar_h5/dist /usr/share/nginx/html
COPY deploy/ar_h5/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3020

CMD ["nginx", "-g", "daemon off;"]
