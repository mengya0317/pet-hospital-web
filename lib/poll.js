// 提交生图任务后"等结果"的通用轮询 —— 工作台（app.js）和 AI 自由生图（aigen/index.html）共用这一份，
// 等待策略只在这里改一处，两边一起生效。
//
// query()        查一次任务，返回接口的原始数据
// check(data)    看数据下结论：{ done: 结果 } 完成 / { fail: "原因" } 失败 / null 还没好
// opts.onProgress(data)            每次查到"还没好"时回调（显示进度用）
// opts.onRetry(第几次, 上限, 错误)   查询出错、准备再试时回调
//
// 策略：每 3 秒查一次，最多等 6 分钟（2K/4K、GPT Image 2.5、多张参考图经常超过 2 分钟）；
// 查询途中偶发网络错误不放弃，连续失败 5 次才报错——任务本身还在跑、照样扣费，别轻易丢掉。
// 抛出的错误带 kind：'fail' 接口明确说失败 / 'query' 一直查不到 / 'timeout' 等太久。
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 6 * 60 * 1000;
const POLL_MAX_ERRS = 5;

async function waitForTask(query, check, opts) {
  opts = opts || {};
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let errStreak = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    let data;
    try { data = await query(); errStreak = 0; }
    catch (e) {
      if (++errStreak >= POLL_MAX_ERRS) throw pollError("query", `查询生成进度连续失败 ${POLL_MAX_ERRS} 次：${e.message}`);
      if (opts.onRetry) opts.onRetry(errStreak, POLL_MAX_ERRS, e);
      continue;
    }
    const r = check(data);
    if (r && "fail" in r) throw pollError("fail", r.fail);
    if (r && "done" in r) return r.done;
    if (opts.onProgress) opts.onProgress(data);
  }
  throw pollError("timeout", `等待超过 ${POLL_TIMEOUT_MS / 60000} 分钟还没出图`);
}

function pollError(kind, msg) { const e = new Error(msg); e.kind = kind; return e; }
