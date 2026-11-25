export async function imageApi(path, method = 'GET', body) {
  let response
  try {
    response = await fetch(path, {
      method, headers: { 'content-type': 'application/json', 'x-hicanvas-client': '1' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } catch { throw new Error('无法连接 hiCanvas 本机服务，请检查服务是否正在运行。') }
  let result
  try { result = await response.json() } catch { throw new Error('本机接口返回异常，请重启 hiCanvas 服务后重试。') }
  if (!response.ok) throw new Error(result.error || '操作失败。')
  return result
}
