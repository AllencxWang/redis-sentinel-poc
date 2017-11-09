FROM node:alpine
RUN mkdir -p /usr/src/app
COPY . /usr/src/app
WORKDIR /usr/src/app
RUN yarn
EXPOSE 3000
CMD [ "npm", "start" ]