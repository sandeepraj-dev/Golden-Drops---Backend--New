# Setup
1. Install Node.js 20+ and MongoDB.
2. Configure MongoDB as a replica set for transactions. For a local single-node development replica set, start mongod with `--replSet rs0`, run `mongosh` then `rs.initiate()`. Use `MONGODB_URI=mongodb://127.0.0.1:27017/oil_broker_db?replicaSet=rs0`.
3. Copy `.env.example` to `.env`. Set a strong `ADMIN_PASSWORD` and random `JWT_SECRET` (32+ characters). Never commit `.env`.
4. Run `npm install`, `npm run seed`, `npm run dev`.
5. Login using `POST /api/v1/auth/login`; use returned Bearer token in Swagger Authorize and subsequent requests.
6. API docs: `/api-docs`; base URL `/api/v1`.

If MongoDB reports transaction-number/replica-set errors, confirm `rs.status()` and the replicaSet query parameter. If login fails, confirm configured admin username/password and whether a user already exists (env password only initializes a new user). If port is busy, change `PORT`.


## Seed troubleshooting
The seed command repairs legacy records that have a missing/null numeric `id` and synchronizes numeric ID counters before seeding. It is safe to rerun. If `npm test` reports `ERR_MODULE_NOT_FOUND` (for example, `zod`), run `npm install` successfully in the project directory before running tests.
