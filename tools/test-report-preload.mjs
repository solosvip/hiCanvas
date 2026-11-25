// Node 24.22.1 的 --test-force-exit 会在异步 stdout 管道排空前退出子进程，
// 丢掉已执行的测试结果：https://github.com/nodejs/node/issues/67149
// 测试进程专用；不改业务环境。也同步父报告器的输出，避免最终文字报告被截断。
// setBlocking 是 Node 内部接口，升级运行时后须重跑 run-tests.test.mjs 的长报告回归。
for (const stream of [process.stdout, process.stderr]) stream._handle?.setBlocking?.(true)
