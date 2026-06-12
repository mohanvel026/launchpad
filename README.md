# LaunchPad — Fullstack Deployment & Hosting Platform

LaunchPad is an agentic, SRE-optimized web hosting and deployment platform (similar to Vercel/Render, but with self-hosting, AI auto-healing, and automatic SSL/domain management). It allows developers to deploy fullstack applications from GitHub or local directories using either a Web Dashboard or a terminal Command Line Interface (CLI).

---

## Repository Structure

The codebase is organized as a monorepo containing three core components:

*   **`client/`**: The frontend React dashboard powered by Vite. It includes real-time WebSocket log streaming, metrics charts, domain mapping, vulnerability summaries, and an SRE AI Chatbot assistant.
*   **`server/`**: The Express.js backend API. It manages database schemas, authenticates users, monitors container health metrics, controls the Nginx proxy routing, and delegates container builds to a Bull MQ job worker.
*   **`cli/`**: A terminal utility allowing developers to log in, view projects, follow logs, and trigger deployments from their local command line.
*   **`infra/`**: Configuration templates for setting up Nginx, PM2 processes (`ecosystem.config.js`), and VM environment configurations (`setup.sh`).

---

## Getting Started

A root-level `package.json` is provided to make local setup and development seamless.

### 1. Installation

Install dependencies for all workspaces (root, client, server, and cli) using a single command:

```bash
npm run install:all
```

### 2. Configuration

Set up local environment configurations before running:

*   **Backend (`server/.env`)**: Copy `server/.env` or configure one with the following core settings:
    *   `PORT`: Port for backend (default `5000`)
    *   `MONGO_URI`: MongoDB connection string
    *   `JWT_SECRET`: Security token secret
    *   `REDIS_HOST` / `REDIS_PORT`: Redis database coordinates (required for deployment queues)
    *   `ENCRYPTION_KEY`: A 32-byte key for storing encrypted environment variables
*   **Frontend (`client/.env`)**: Define backend API and socket URLs:
    ```env
    VITE_API_URL=http://localhost:5000/api
    VITE_SOCKET_URL=http://localhost:5000
    VITE_DOMAIN=localhost
    ```

### 3. Local Development

Run the frontend and backend concurrently:

```bash
npm run dev
```

The frontend will be available at `http://localhost:5173`, and the backend server runs on `http://localhost:5000`.

---

## Building and Deploying for Production

### Frontend Build
Compile the React dashboard into static assets:
```bash
npm run build:client
```
The compiled assets will be built into `client/dist`. The Express backend will automatically serve these static assets in production mode.

### Backend Start
Run the production server:
```bash
npm run start:server
```

### Server Setup (Oracle Cloud / Ubuntu VPS)
To host LaunchPad on your own server:
1. Copy the setup script from `infra/setup.sh` to your VM and run it:
   ```bash
   bash infra/setup.sh
   ```
   *This automatically installs Node.js, Docker, Nginx, Redis, Certbot, and PM2.*
2. Set up your repository in `/var/launchpad` and build the client (`npm run build:client`).
3. Deploy the backend server under PM2 using the ecosystem configuration:
   ```bash
   pm2 start infra/ecosystem.config.js
   ```
