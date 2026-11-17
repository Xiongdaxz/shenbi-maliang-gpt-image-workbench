import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { initMcpConnectionSchema } from "./externalMcpConnections";

test("connection migration preserves DCR grants and supports distinct shared-client connections", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`create table oauth_clients (id text primary key, device_name text, device_type text);
      create table oauth_grants (id text primary key, user_id text, client_id text);
      create unique index oauth_grants_user_client_idx on oauth_grants(user_id,client_id);
      insert into oauth_clients values ('legacy','PC-ONE','Windows');
      insert into oauth_grants values ('grant-old','user','legacy');`);
    initMcpConnectionSchema(db);
    initMcpConnectionSchema(db);
    expect(db.query("select * from oauth_grants").get()).toEqual({
      id: "grant-old", user_id: "user", client_id: "legacy", connection_key: "", device_name: "PC-ONE", device_type: "Windows"
    });
    expect(() => db.run("insert into oauth_grants (id,user_id,client_id) values ('duplicate','user','legacy')")).toThrow();
    db.run("insert into oauth_grants (id,user_id,client_id,connection_key,device_name,device_type) values ('new','user','legacy','connection-two','','')");
    initMcpConnectionSchema(db);
    expect(db.query("select device_name from oauth_grants where id='new'").get()).toEqual({ device_name: "" });
    expect(db.query("select count(*) as n from oauth_grants").get()).toEqual({ n: 2 });
  } finally { db.close(); }
});
