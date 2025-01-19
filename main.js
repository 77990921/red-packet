// 获取DOM元素
const genderButtons = document.querySelectorAll('.gender-btn');
const uploadInput = document.getElementById('photo-upload');
const previewArea = document.getElementById('preview-area');
const submitButton = document.querySelector('.submit-btn');
const resultSection = document.querySelector('.result-section');
const downloadButton = document.querySelector('.download-btn');

// 性别选择逻辑
let selectedGender = null;
genderButtons.forEach(button => {
    button.addEventListener('click', (e) => {
        selectedGender = e.target.dataset.gender;
        // 移除所有按钮的活跃状态
        genderButtons.forEach(btn => btn.classList.remove('active'));
        // 添加当前按钮的活跃状态
        e.target.classList.add('active');
    });
});

// 添加性别检测功能
async function detectGender(imageFile) {
    try {
        const formData = new FormData();
        formData.append('image', imageFile);
        
        // 调用人脸识别API
        const response = await fetch('/api/detect-gender', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error('性别检测失败');
        }
        
        const result = await response.json();
        return result.gender; // 返回 'male' 或 'female'
    } catch (error) {
        console.error('性别检测错误:', error);
        return null;
    }
}

// 修改文件上传处理逻辑
uploadInput.addEventListener('change', async function(e) {
    const file = e.target.files[0];
    if (file) {
        // 文件验证逻辑保持不变
        if (!file.type.match('image.*')) {
            alert('请上传图片文件！');
            return;
        }
        
        if (file.size > 5 * 1024 * 1024) {
            alert('图片大小不能超过5MB！');
            return;
        }

        // 显示加载状态
        previewArea.innerHTML = '<div class="loading">正在分析图片...</div>';

        // 预览图片
        const reader = new FileReader();
        reader.onload = async function(e) {
            previewArea.innerHTML = `
                <img src="${e.target.result}" alt="预览图" style="max-width: 100%; height: auto;">
            `;
            
            // 自动检测性别
            const detectedGender = await detectGender(file);
            if (detectedGender) {
                // 自动选择性别按钮
                genderButtons.forEach(btn => {
                    if (btn.dataset.gender === detectedGender) {
                        btn.click();
                    }
                });
                
                // 连接到对应的工作流
                connectToWorkflow(detectedGender, file);
            } else {
                alert('无法自动检测性别，请手动选择');
            }
        };
        reader.readAsDataURL(file);
    }
});

// 连接到工作流的函数
async function connectToWorkflow(gender, imageFile) {
    try {
        const formData = new FormData();
        formData.append('image', imageFile);
        formData.append('gender', gender);

        // 根据性别选择工作流URL
        const workflowUrl = gender === 'male' ? 
            '/api/workflow/male' : 
            '/api/workflow/female';

        // 调用相应的工作流
        const response = await fetch(workflowUrl, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error('工作流处理失败');
        }

        const result = await response.json();
        
        // 处理工作流返回结果
        if (result.status === 'success') {
            // 更新界面显示处理进度
            updateProcessStatus(result.progress);
            // 显示处理结果
            showResult(result.resultUrl);
        } else {
            throw new Error(result.message || '处理失败');
        }
    } catch (error) {
        console.error('工作流处理错误:', error);
        alert('处理失败，请重试');
    }
}

// 更新处理进度的函数
function updateProcessStatus(progress) {
    // 创建或更新进度显示
    let statusElement = document.querySelector('.process-status');
    if (!statusElement) {
        statusElement = document.createElement('div');
        statusElement.className = 'process-status';
        previewArea.appendChild(statusElement);
    }
    statusElement.innerHTML = `处理进度: ${progress}%`;
}

// 表单提交处理
submitButton.addEventListener('click', async () => {
    if (!validateForm()) {
        return;
    }

    try {
        submitButton.disabled = true;
        submitButton.textContent = '处理中...';

        // 收集表单数据
        const formData = new FormData();
        formData.append('photo', uploadInput.files[0]);
        formData.append('gender', selectedGender);
        formData.append('style', document.querySelector('input[name="style"]:checked').value);
        formData.append('background', document.querySelector('input[name="background"]:checked').value);

        // 发送到服务器
        const response = await uploadAndProcess(formData);
        
        // 显示结果
        showResult(response.resultUrl);
    } catch (error) {
        alert('处理失败，请重试！');
        console.error('Error:', error);
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = '开始转化';
    }
});

// 表单验证
function validateForm() {
    if (!selectedGender) {
        alert('请选择性别！');
        return false;
    }
    
    if (!uploadInput.files[0]) {
        alert('请上传照片！');
        return false;
    }
    
    if (!document.querySelector('input[name="style"]:checked')) {
        alert('请选择风格！');
        return false;
    }
    
    if (!document.querySelector('input[name="background"]:checked')) {
        alert('请选择背景！');
        return false;
    }
    
    return true;
}

// 上传并处理图片
async function uploadAndProcess(formData) {
    const response = await fetch('/api/process-image', {
        method: 'POST',
        body: formData
    });
    
    if (!response.ok) {
        throw new Error('网络请求失败');
    }
    
    return await response.json();
}

// 显示结果
function showResult(resultUrl) {
    resultSection.style.display = 'block';
    resultSection.querySelector('.result-image').innerHTML = `
        <img src="${resultUrl}" alt="处理结果" style="max-width: 100%; height: auto;">
    `;
    
    // 滚动到结果区域
    resultSection.scrollIntoView({ behavior: 'smooth' });
}

// 下载结果
downloadButton.addEventListener('click', async () => {
    const resultImage = resultSection.querySelector('.result-image img');
    if (resultImage) {
        try {
            const response = await fetch(resultImage.src);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = '拜年动画.gif';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            alert('下载失败，请重试！');
            console.error('Download error:', error);
        }
    }
}); 