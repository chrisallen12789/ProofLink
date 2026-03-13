# Honest To Crust — Azure Email Functions

This folder is a drop-in Azure Functions (Node 18, v4 model) project that replaces Netlify email functions.
It exposes:
- POST /api/contact
- POST /api/order

## Local run
1) Install Azure Functions Core Tools
2) Copy local.settings.json.example -> local.settings.json and fill ACS_CONNECTION_STRING
3) npm install
4) func start

## Deploy
Create an Azure Function App (Node 18, Functions v4) and deploy this folder.

## Wire the website
Set these once (recommended in layout.js on the site):
  window.HTC_EMAIL_API_BASE = "https://YOUR-FUNCTION-APP.azurewebsites.net";
  window.HTC_EMAIL_API_KEY  = "YOUR_FUNCTION_KEY";

Then the existing site forms posting to /api/contact and /api/order will route to Azure automatically.

