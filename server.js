const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// 修改 COMFY_API 配置，确保在 Vercel 环境中正确工作
const COMFY_API = process.env.COMFY_API || 'http://127.0.0.1:6006';

const app = express();

// 基础中间件配置
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// 在 Vercel 环境中使用内存存储而不是文件系统
const storage = process.env.VERCEL 
    ? multer.memoryStorage()
    : multer.diskStorage({
        destination: 'uploads/',
        filename: (req, file, cb) => {
            cb(null, file.originalname);
        }
    });

const upload = multer({ storage });

// 只在本地环境创建 uploads 目录
if (!process.env.VERCEL && !fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// 静态文件服务
app.use(express.static(__dirname));

// 健康检查接口
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        comfyui_url: COMFY_API,
        server_time: new Date().toISOString(),
        message: '服务正常运行'
    });
});

// 工作流配置映射
const workflowConfig = {
    'shanzi_gif_api.json': {
        inputNode: '21',    // LoadImage节点
        outputNode: '97',   // SaveImage节点
        outputType: 'images'
    },
    'snake_anime_api.json': {
        inputNode: '21',    // LoadImage节点
        outputNode: '94',   // SaveImage节点
        outputType: 'images'
    },
    'snake_photo_api.json': {
        inputNode: '27',    // LoadImage节点
        outputNode: '120',  // SaveImage节点
        outputType: 'images'
    },
    'food_anime_api.json': {
        inputNode: '21',    // LoadImage节点
        outputNode: '94',   // SaveImage节点
        outputType: 'images'
    },
    'food_photo_api.json': {
        inputNode: '27',
        outputNode: '120',
        outputType: 'images'
    },
    'fan_photo_api.json': {
        inputNode: '27',
        outputNode: '120',
        outputType: 'images'
    }
};

// 等待工作流执行完成的函数
async function waitForResult(promptId, config) {
    let retryCount = 0;
    const maxRetries = 300; // 5分钟超时
    
    while (retryCount < maxRetries) {
        try {
            console.log(`[${retryCount}] 检查工作流状态: ${promptId}`);
            const historyResponse = await fetch(`${COMFY_API}/history/${promptId}`);
            const history = await historyResponse.json();
            
            console.log('工作流历史:', JSON.stringify(history, null, 2));
            
            if (history[promptId] && history[promptId].outputs) {
                const outputs = history[promptId].outputs;
                const outputNode = config.outputNode;
                
                console.log('找到输出节点:', outputNode);
                console.log('输出内容:', outputs);
                
                if (outputs[outputNode]) {
                    const output = outputs[outputNode];
                    if (output[config.outputType] && output[config.outputType].length > 0) {
                        const file = output[config.outputType][0];
                        console.log('找到输出文件:', file);
                        return {
                            output_url: process.env.NODE_ENV === 'production'
                                ? `/api/view?filename=${encodeURIComponent(file.filename)}&type=output&subfolder=${encodeURIComponent(file.subfolder || '')}`
                                : `${COMFY_API}/view?filename=${encodeURIComponent(file.filename)}&type=output&subfolder=${encodeURIComponent(file.subfolder || '')}`
                        };
                    }
                }
            }
            
            // 检查工作流状态
            if (history[promptId] && history[promptId].status) {
                console.log('工作流状态:', history[promptId].status);
            }
            
            // 检查错误
            if (history[promptId] && history[promptId].error) {
                console.error('工作流错误:', history[promptId].error);
                throw new Error(`工作流执行错误: ${history[promptId].error}`);
            }
            
            console.log(`等待工作流执行... (${retryCount + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            retryCount++;
        } catch (error) {
            console.error('检查结果时出错:', error);
            await new Promise(resolve => setTimeout(resolve, 1000));
            retryCount++;
        }
    }
    
    throw new Error('等待超时：工作流执行时间过长');
}

// 生成随机种子
function generateRandomSeed() {
    return Math.floor(Math.random() * 1000000000000000);
}

// 更新KSampler节点的种子
function updateSamplerSeeds(workflow) {
    for (const nodeId in workflow) {
        const node = workflow[nodeId];
        if (node.class_type === 'KSampler' && node.inputs && 'seed' in node.inputs) {
            node.inputs.seed = generateRandomSeed();
        }
    }
    return workflow;
}

app.post('/api/generate', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            throw new Error('未上传图片');
        }

        // 准备图片数据
        const formData = new FormData();
        if (process.env.VERCEL) {
            // 在 Vercel 环境中使用内存中的文件数据
            formData.append('image', req.file.buffer, {
                filename: req.file.originalname,
                contentType: req.file.mimetype
            });
        } else {
            // 在本地环境中使用文件系统
            formData.append('image', fs.createReadStream(req.file.path));
        }

        // 检查ComfyUI是否可访问
        try {
            const comfyResponse = await fetch(`${COMFY_API}/history`);
            console.log('ComfyUI状态:', comfyResponse.status);
            if (!comfyResponse.ok) {
                throw new Error(`ComfyUI服务未正确响应: ${comfyResponse.status}`);
            }
        } catch (error) {
            console.error('ComfyUI连接失败:', error);
            throw new Error('无法连接到ComfyUI服务');
        }

        const workflowName = req.body.workflow;
        console.log('使用工作流:', workflowName);
        
        // 检查工作流文件是否存在
        const workflowPath = path.join(__dirname, workflowName);
        console.log('工作流路径:', workflowPath);
        console.log('工作流文件是否存在:', fs.existsSync(workflowPath));
        
        const config = workflowConfig[workflowName];
        
        if (!config) {
            throw new Error(`未找到工作流 ${workflowName} 的配置`);
        }

        // 1. 上传图片
        const uploadResponse = await fetch(`${COMFY_API}/upload/image`, {
            method: 'POST',
            body: formData
        });

        if (!uploadResponse.ok) {
            throw new Error('图片上传失败');
        }

        const uploadResult = await uploadResponse.json();
        console.log('图片上传成功:', uploadResult);

        // 2. 加载工作流
        let workflow;
        try {
            workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
        } catch (error) {
            throw new Error(`工作流文件读取失败: ${workflowName}`);
        }

        // 3. 更新工作流中的图片节点
        workflow[config.inputNode].inputs.image = uploadResult.name;
        
        // 4. 更新随机种子
        workflow = updateSamplerSeeds(workflow);

        // 5. 执行工作流
        const promptResponse = await fetch(`${COMFY_API}/prompt`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                prompt: workflow
            })
        });

        if (!promptResponse.ok) {
            throw new Error('工作流执行失败');
        }

        const promptResult = await promptResponse.json();
        
        // 6. 等待结果
        const result = await waitForResult(promptResult.prompt_id, config);
        
        // 7. 返回结果
        res.json(result);

    } catch (error) {
        console.error('处理失败:', error);
        res.status(500).json({
            error: '生成失败',
            details: error.message
        });
    } finally {
        // 只在本地环境清理文件
        if (!process.env.VERCEL && req.file) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('清理临时文件失败:', err);
            });
        }
    }
});

// 添加ComfyUI状态检查函数
async function checkComfyStatus() {
    try {
        const response = await fetch(`${COMFY_API}/history`);
        return {
            status: response.status,
            ok: response.ok
        };
    } catch (error) {
        return {
            error: error.message
        };
    }
}

app.get('/api/view', async (req, res) => {
    try {
        const { filename, type, subfolder } = req.query;
        const fileUrl = `${COMFY_API}/view?filename=${encodeURIComponent(filename)}&type=${type}&subfolder=${encodeURIComponent(subfolder || '')}`;

        // 从ComfyUI获取文件
        const response = await fetch(fileUrl);
        if (!response.ok) {
            throw new Error('文件获取失败');
        }

        // 获取文件内容和类型
        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        const buffer = await response.buffer();

        // 设置响应头
        res.setHeader('Content-Type', contentType);
        res.setHeader('Access-Control-Allow-Origin', '*');
        
        // 发送文件
        res.send(buffer);

    } catch (error) {
        console.error('获取文件失败:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/download', async (req, res) => {
    try {
        const fileUrl = req.query.url;
        if (!fileUrl) {
            throw new Error('未提供文件URL');
        }

        console.log('开始下载文件:', fileUrl);

        // 从ComfyUI获取文件
        const response = await fetch(fileUrl);
        if (!response.ok) {
            throw new Error('文件获取失败');
        }

        // 获取文件内容和类型
        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        const buffer = await response.buffer();

        // 根据URL判断文件类型和名称
        const isGif = fileUrl.toLowerCase().includes('gif') || contentType.includes('gif');
        const filename = `专属拜年图像${isGif ? '.gif' : '.png'}`;

        // 设置响应头
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
        
        console.log('准备发送文件:', filename, contentType);
        
        // 发送文件
        res.send(buffer);

    } catch (error) {
        console.error('下载失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// 添加错误处理中间件
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).json({
        error: '服务器错误',
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

app.listen(8188, '0.0.0.0', () => {  // Node.js使用8188端口
    console.log('服务器运行在 http://0.0.0.0:8188');
    console.log('ComfyUI地址:', COMFY_API);
});

// 导出 app 以供 Vercel 使用
module.exports = app; 