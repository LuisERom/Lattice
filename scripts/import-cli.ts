// Import a generation contract JSON file into the database.
//   npm run import                 imports data/seed-topic.json
//   npm run import -- path/to.json  imports a specific file
import { readFileSync } from "node:fs";
import path from "node:path";
import { importMap } from "../lib/import";
import type { ContractMap } from "../lib/import/contract";

const arg = process.argv[2];
const file = arg
  ? path.resolve(process.cwd(), arg)
  : path.join(process.cwd(), "data", "seed-topic.json");

const map = JSON.parse(readFileSync(file, "utf8")) as ContractMap;
const result = importMap(map);

console.log(`Imported "${map.topic.name}" (topic id ${result.topicId}) from ${file}`);
console.table(result.counts);
