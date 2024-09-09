import { LLM, LLMConfig } from "./llm.ts"
import { Task, tasks } from "./tasks.ts";
import { deepMerge, parseArgs, permutate, uniqueVariants } from "./utils.ts";
import { BenchConfig, config } from './config.ts';
import { BenchTask } from "./task.ts";
import { BenchRun } from "./run.ts";
import { csv, yaml } from './deps.ts';

export class BenchRunner {
  static async init(config: BenchConfig) {
    const [
      scenarios,
      tasks,
    ] = await Promise.all([
      BenchRunner.prepareScenarios(config),
      BenchRunner.prepareTasks(config),
    ]);

    return new BenchRunner(scenarios, tasks);
  }

  static async prepareScenarios(config: BenchConfig): Promise<LLMConfig[]> {
    // Base Config
    const base = [
      [config.llm]
    ];

    // Arbitrary set of variants to override the base
    // "--model a --model b --temperature 0.25 --temperature 0.75"
    // will produce 4 scenarios (2 models * 2 temperatures = 4 scenarios)
    const variants = Object.fromEntries(
      Object.entries(
        parseArgs(config.variants.split(' '))
      )
        .map(([key, value]) => [key, Array.isArray(value) ? value : [value]])
    );

    // One final permutation with the base options
    const draftScenarios = uniqueVariants(variants);
    const final = permutate(base, draftScenarios).map(opts => {
      if (Array.isArray(opts)) {
        return deepMerge(...opts);
      }

      return opts;
    });

    return final;
  }

  static async prepareTasks(config: BenchConfig): Promise<BenchTask[]> {
    const tasksYaml = await Deno.readTextFile(config.tasks);
    const tasks = yaml.parse(tasksYaml);

    return tasks;
  }

  public runs: BenchRun[];

  constructor(
    public readonly scenarios: LLMConfig[],
    public readonly tasks: Task[]
  ) {
    this.runs = scenarios.map((scenario) => {
      return new BenchRun({
        llm: new LLM(scenario),
        judge: new LLM(config.judge),
        tasks: tasks.map((t: Task) => new BenchTask(t)),
      });
    });
  }

  async run() {
    let runs = 0;

    for (const run of this.runs) {
      console.log(`Run ${++runs}/${this.runs.length}`);
      await run.run();
      await this.save();
    }
  }

  async eval() {
    let evals = 0;

    for (const run of this.runs) {
      console.log(`Evals ${++evals}/${this.runs.length}`);
      await run.eval();
      await this.save();
    }
  }

  async save() {
    const output = `${config.output}/${config.name}`;
    const results = this.runs.map((r) => r.toResults()).flat();
    const columns = Object.keys(results[0]);

    await Deno.mkdir(output, { recursive: true });
    await Promise.all([
      Deno.writeTextFile(`${output}/config.json`, JSON.stringify(config, null, 2)),
      Deno.writeTextFile(`${output}/runs.json`, JSON.stringify(this.runs, null, 2)),
      Deno.writeTextFile(`${output}/results.json`, JSON.stringify(results, null, 2)),
      Deno.writeTextFile(`${output}/results.csv`, csv.stringify(results, {
        columns,
      })),
    ]);
  }
}