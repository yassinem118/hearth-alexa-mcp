# Deploy (optional)
Judges may prefer a live link. Any Node or Docker host works.

    docker build -t hearth . 
    docker run -p 3000:3000 -e ALLOWED_ORIGINS=https://YOUR.DOMAIN -e ALLOWED_HOSTS=YOUR.DOMAIN hearth

Without `ALLOWED_ORIGINS` / `ALLOWED_HOSTS` the server (correctly) answers 403 to browsers on your domain: that is the DNS-rebinding protection required by the MCP spec.
State is in memory and the demo clock is global, so use a single instance and treat it as a demo, not a multi-user service. Add authentication before any real use.
