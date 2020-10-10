################################################################################
## Build stage
################################################################################

FROM node:10 as builder

# Install all node dependencies.
ADD package.json package.json
RUN npm i

# Build node code.
ADD tsconfig.json tsconfig.json
ADD app app
ADD stubs stubs
ADD buildtools buildtools
ADD static static
RUN npm run build:prod

# Install all python dependencies.
ADD sandbox/requirements.txt requirements.txt
RUN \
  apt update && \
  apt install -y python-pip && \
  pip install -r requirements.txt

################################################################################
## Run-time stage
################################################################################

# Now, start preparing final image.
FROM node:10-slim

# Copy node files.
COPY --from=builder /node_modules node_modules
COPY --from=builder /_build _build
COPY --from=builder /static static

# Copy python files.
COPY --from=builder /usr/bin/python2.7 /usr/bin/python2.7
COPY --from=builder /usr/lib/python2.7 /usr/lib/python2.7
COPY --from=builder /usr/local/lib/python2.7 /usr/local/lib/python2.7

# Add files needed for running server.
ADD package.json package.json
ADD ormconfig.js ormconfig.js
ADD bower_components bower_components
ADD sandbox sandbox

# Set some default environment variables to give a setup that works out of the box when
# started as:
#   docker run -p 8484:8484 -it <image>
# Variables will need to be overridden for other setups.
ENV GRIST_ORG_IN_PATH=true
ENV GRIST_HOST=0.0.0.0
ENV APP_HOME_URL=http://localhost:8484
ENV GRIST_DATA_DIR=docs
RUN mkdir -p docs
EXPOSE 8484
CMD npm run start:prod
