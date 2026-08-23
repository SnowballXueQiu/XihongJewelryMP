# syntax=docker/dockerfile:1.7
FROM gradle:9.1-jdk21-alpine AS build
WORKDIR /workspace
ENV GRADLE_USER_HOME=/home/gradle/.gradle
COPY settings.gradle.kts build.gradle.kts ./
COPY src ./src
RUN --mount=type=cache,id=xihong-gradle-cache,target=/home/gradle/.gradle,uid=1000,gid=1000,sharing=locked \
    gradle --no-daemon --build-cache bootJar

FROM eclipse-temurin:21-jre-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build /workspace/build/libs/*.jar /app/app.jar
COPY --chown=app:app docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN mkdir -p /app/uploads \
    && chown -R app:app /app \
    && chmod 0555 /usr/local/bin/docker-entrypoint.sh
USER app
EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
