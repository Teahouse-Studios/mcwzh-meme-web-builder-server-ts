# 梗体中文 · 在线打包

这里是在线打包部署部分，若要更新内容请前往[基岩版仓库](https://github.com/Teahouse-Studios/mcwzh-meme-resourcepack-bedrock/)或[Java版仓库](https://github.com/Teahouse-Studios/mcwzh-meme-resourcepack/)。

## 环境准备

请安装 NodeJs 和 [serverless](https://www.npmjs.com/package/serverless), 并配置[阿里云账户](https://help.aliyun.com/document_detail/295894.html), 此处不再赘述，下文中与 serverless 相关的内容或报错请自行解决。

## 服务端搭建

clone本仓库后，请额外clone Java版和基岩版的内容。并将 data 目录文件夹[同步至阿里云nas](https://help.aliyun.com/document_detail/295906.html), 确保 `/mnt/meme/mcwzh-meme-resourcepack` 等内容能正常读写。

``` bash
cd data
git clone https://github.com/Teahouse-Studios/mcwzh-meme-resourcepack
git clone https://github.com/Teahouse-Studios/mcwzh-meme-resourcepack-bedrock
```

首次部署时需要 docker 安装依赖，复制 `template.example.yml` 到 `template.yml`, 并填写相关配置, 运行`yarn build && yarn deploy` 部署至线上环境。