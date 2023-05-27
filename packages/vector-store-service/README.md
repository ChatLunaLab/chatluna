## koishi-plugin-chathub-vector-store-service

## [![npm](https://img.shields.io/npm/v/@dingyi222666/koishi-plugin-vector-store-service)](https://www.npmjs.com/package/@dingyi222666/koishi-plugin-chathub-vector-store-service) [![npm](https://img.shields.io/npm/dt/@dingyi222666/koishi-plugin-chathub-vector-store-service)](https://www.npmjs.com/package/@dingyi222666/koishi-plugin-chathub-vector-store-service)

> 为 ChatHub 提供一些向量数据库支持的插件

## 怎么使用？

1. 在插件市场安装本插件(`vector-store-service`)，并安装好本插件依赖的前置插件
2. 在插件的配置项选择你要使用的平台/模型，填写相关配置后启用本插件
3. 就可以调用`chathub.listembeddings`，列举向量数据库列表，再调用`chathub.setembeddings`，设置向量数据库模型了。