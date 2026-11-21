import { build } from 'vite'

await build()
// 上游的构建依赖可能保留开发用句柄；构建结果写完后结束一次性命令。
process.exit(0)
