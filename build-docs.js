const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'public/index.html');
const dst = path.join(__dirname, 'docs/index.html');

fs.mkdirSync(path.join(__dirname, 'docs'), { recursive: true });

let c = fs.readFileSync(src, 'utf8');
const SERVER = 'https://ai.mmuc.cn';

// 所有 openModal 按钮改为跳转真实服务器
c = c.replace(/onclick="openModal\('register'\)"/g, `onclick="window.open('${SERVER}','_blank')"`);
c = c.replace(/onclick="openModal\('login'\)"/g, `onclick="window.open('${SERVER}','_blank')"`);
c = c.replace(/onclick="openModal\('forgot'\)"/g, `onclick="window.open('${SERVER}','_blank')"`);

// 控制台链接改为真实地址
c = c.replace(/href="\/console"/g, `href="${SERVER}/console" target="_blank"`);

// 移除登录注册弹窗 JS 逻辑（展示页不需要，保留页面结构）
// 在 title 加标识
c = c.replace('<title>FanBaaS', '<title>FanBaaS - Demo');

// 在 nav 登录按钮改为直接跳转
c = c.replace(
  `<button class="btn btn-outline btn-sm" onclick="openModal('login')">登录</button>`,
  `<a href="${SERVER}" target="_blank" class="btn btn-outline btn-sm">登录</a>`
);
c = c.replace(
  `<button class="btn btn-primary btn-sm" onclick="openModal('register')">免费注册</button>`,
  `<a href="${SERVER}" target="_blank" class="btn btn-primary btn-sm">免费注册</a>`
);

// hero 按钮
c = c.replace(
  `<button class="btn btn-primary" onclick="openModal('register')">免费开始使用</button>`,
  `<a href="${SERVER}" target="_blank" class="btn btn-primary">免费开始使用</a>`
);

// cta 按钮
c = c.replace(
  `<button class="btn btn-primary" style="font-size:15px;padding:14px 40px;" onclick="openModal('register')">免费注册</button>`,
  `<a href="${SERVER}" target="_blank" class="btn btn-primary" style="font-size:15px;padding:14px 40px;">免费注册</a>`
);

// 定价按钮
c = c.replace(/onclick="openModal\('register'\)"/g, `onclick="window.open('${SERVER}','_blank')"`);

// 移除弹窗 modal 和 JS（减小体积，展示页不需要）
c = c.replace(/<!-- 登录\/注册弹窗 -->[\s\S]*?<\/div>\s*\n\s*<script>/,
  `\n<script>\n// FanBaaS Demo Page - Powered by GitHub Pages\n// Real service: ${SERVER}\n`
);

// 移除 doLogin/doRegister/doForgotPassword/setLoggedIn 等函数，替换为空
c = c.replace(/function setLoggedIn[\s\S]*?function clearAuth/,
  `function setLoggedIn(){} function clearAuth`
);
c = c.replace(/function doLogout[\s\S]*?function openModal/,
  `function doLogout(){ window.open('${SERVER}','_blank'); } function openModal`
);
c = c.replace(/function openModal[\s\S]*?function closeModal/,
  `function openModal(){ window.open('${SERVER}','_blank'); } function closeModal`
);
c = c.replace(/function doLogin[\s\S]*?function doRegister/,
  `function doLogin(){} function doRegister`
);
c = c.replace(/async function doRegister[\s\S]*?function showErr/,
  `function doRegister(){} function showErr`
);
c = c.replace(/function showErr[\s\S]*?\/\/ 页面加载时检查登录状态/,
  `function showErr(){}\n// 页面加载时检查登录状态`
);

// init 函数改为空
c = c.replace(/\(function init\(\)[\s\S]*?\}\)\(\);/, '// Demo mode - no auth needed');

fs.writeFileSync(dst, c, 'utf8');
console.log('docs/index.html built, size:', Math.round(c.length / 1024) + 'KB');
