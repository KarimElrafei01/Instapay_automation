import { Global, Module, OnApplicationShutdown } from "@nestjs/common";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;

export const DATABASE = Symbol("DATABASE");

export class DatabaseClient implements OnApplicationShutdown {
  public readonly database: Database;
  private readonly pool: Pool;

  public constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is required to start the server.");
    }

    this.pool = new Pool({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
    this.database = drizzle({ client: this.pool, schema });
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    DatabaseClient,
    { provide: DATABASE, useFactory: (client: DatabaseClient) => client.database, inject: [DatabaseClient] },
  ],
  exports: [DATABASE],
})
export class DatabaseModule {}
