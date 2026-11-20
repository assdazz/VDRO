# Windows 可信代码签名

目前安装包仍未签名。本项目使用 electron-builder 26.18.0，签名配置以该版本为准；新版 v27 的 win.sign 配置不能直接套用。

## 需要准备

1. 确定真实发布者身份（个人或组织），申请服务商支持的公开信任代码签名证书，完成身份验证。证书显示的发布者由验证身份决定，不能随意写成软件名。
2. 获得受支持的签名方式：证书服务商的硬件令牌、云 HSM，或符合条件的云签名服务。不要假设新申请证书一定提供可导出的 PFX。
3. 在构建电脑安装服务商驱动、证书或签名客户端，完成授权，使 SignTool 或签名服务能访问私钥。

Microsoft Artifact Signing 当前对身份验证有地域限制：组织为美国、加拿大、欧盟、英国；个人为美国、加拿大。若使用中国大陆身份，应先向支持该身份和地区的受信任 CA 确认申请资格及签名方式，而不是直接注册此服务并假设能够通过验证。

## 接入本项目

证书进入 Windows 证书库，且供应商提供兼容的签名驱动时，可在现有 electron-builder.yml 中合并下面的配置；主体名称必须替换为实际证书名称。云 HSM 可能需要供应商自己的签名回调，不能只改主体名称。

```yaml
forceCodeSigning: true
win:
  signtoolOptions:
    certificateSubjectName: "证书中的真实主体名称"
    signingHashAlgorithms:
      - sha256
    rfc3161TimeStampServer: "http://timestamp.digicert.com"
```

forceCodeSigning 使正式构建在未取得签名凭据时失败，避免悄悄产出未签名安装包。在签名凭据准备好后启用该配置。

符合 Microsoft 云签名资格时，electron-builder 26 使用 win.azureSignOptions，并通过环境或构建系统注入身份授权信息。不要同时配置两个签名后端。

运行 npm run dist，签名在生成过程中完成，覆盖主程序、卸载程序和安装程序。单独编译的便携版 VDRO.exe 启动器需要另行签名。签名后应验证证书链、发布者和时间戳，再重新生成 SHA256 发布校验值。

```powershell
Get-AuthenticodeSignature -LiteralPath '.\release\VDRO安装程序-1.2.5-x64.exe'
```

可信签名用于验证发布者和文件完整性，并不保证新发布者立刻没有 SmartScreen 提示；EV 也不保证立即免提示。没有证书和身份授权时，无法在本地凭空生成公开信任的签名。

参考：

- [Microsoft 代码签名选项](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
- [Microsoft SmartScreen 信誉说明](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation)
- [electron-builder 26 Windows 签名配置](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/)
