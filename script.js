document.addEventListener("DOMContentLoaded", () => {
    const logContainer = document.getElementById('logContainer');
    const logArea = document.getElementById('logArea');
    const deployBtn = document.getElementById('deployBtn');
    const deleteBtn = document.getElementById('deleteBtn');

    deployBtn.addEventListener('click', mulaiDeploy);
    deleteBtn.addEventListener('click', hapusRepo);

    function log(pesan, isHtml = false) {
        logContainer.style.display = 'block';
        logArea.style.display = 'block';
        const p = document.createElement('div');
        if (isHtml) {
            p.innerHTML = `> ${pesan}`;
        } else {
            p.textContent = `> ${pesan}`;
        }
        logArea.appendChild(p);
        logArea.scrollTop = logArea.scrollHeight;
    }

    // ==========================================
    // 1. FUNGSI DEPLOY & INJEKSI WAKTU 24 JAM
    // ==========================================
    async function mulaiDeploy() {
        const token = document.getElementById('ghToken').value.trim();
        const repoName = document.getElementById('repoName').value.trim();
        const fileInput = document.getElementById('zipFile').files[0];
        const autoKill = document.getElementById('autoKill').checked;

        if (!token || !repoName || !fileInput) {
            alert("Harap lengkapi Token, Nama Repo, dan Upload ZIP!");
            return;
        }

        tombolLoading(deployBtn, true);
        logArea.innerHTML = ''; 

        const headers = {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'X-GitHub-Api-Version': '2022-11-28'
        };

        try {
            log("Memverifikasi token...");
            const userRes = await fetch('https://api.github.com/user', { headers });
            if (!userRes.ok) throw new Error("Token tidak valid!");
            const username = (await userRes.json()).login;

            log(`Membuat repositori: ${repoName}...`);
            const repoRes = await fetch('https://api.github.com/user/repos', {
                method: 'POST',
                headers,
                body: JSON.stringify({ name: repoName, auto_init: true })
            });
            if (!repoRes.ok && repoRes.status !== 422) throw new Error("Gagal membuat Repo.");

            log("Membaca isi ZIP...");
            const zip = await JSZip.loadAsync(fileInput);
            const files = Object.keys(zip.files);

            for (const filename of files) {
                const file = zip.files[filename];
                if (!file.dir) {
                    log(`Menganalisis: ${filename}`);

                    // INJEKSI BOM WAKTU (Simulasi Mati 24 Jam)
                    if (filename.toLowerCase() === 'index.html' && autoKill) {
                        log("⚠️ Menyuntikkan script pelumpuh 24 Jam...");
                        let htmlStr = await file.async("string");
                        
                        // Hitung waktu 24 jam dari sekarang dalam milidetik
                        const expireTime = Date.now() + (24 * 60 * 60 * 1000);
                        const scriptInject = `
                        <!-- Script Auto-Kill Testing (Dibuat otomatis) -->
                        <script>
                            (function(){
                                const expire = ${expireTime};
                                if(Date.now() > expire) {
                                    document.documentElement.innerHTML = '<body style="background:#0f2027;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;text-align:center;"><div><h1 style="color:#ff4b4b;font-size:3rem;margin:0;">🛑 Akses Ditolak</h1><p style="color:#aaa;margin-top:10px;">URL Testing ini sudah kadaluarsa (Melewati batas 24 Jam).</p></div></body>';
                                }
                            })();
                        </script>`;
                        
                        if (htmlStr.includes('</head>')) {
                            htmlStr = htmlStr.replace('</head>', scriptInject + '</head>');
                        } else {
                            htmlStr += scriptInject;
                        }
                        zip.file(filename, htmlStr);
                    }

                    // Upload file
                    const contentBase64 = await zip.file(filename).async("base64");
                    await fetch(`https://api.github.com/repos/${username}/${repoName}/contents/${filename}`, {
                        method: 'PUT',
                        headers,
                        body: JSON.stringify({ message: `Upload ${filename}`, content: contentBase64 })
                    });
                }
            }

            log("Menyalakan GitHub Pages...");
            await new Promise(r => setTimeout(r, 2000)); 

            const pagesRes = await fetch(`https://api.github.com/repos/${username}/${repoName}/pages`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ source: { branch: "main", path: "/" } })
            });

            if (pagesRes.ok || pagesRes.status === 409) {
                const url = `https://${username}.github.io/${repoName}/`;
                log("✅ DEPLOY SELESAI!");
                log(`🌐 Link (Tunggu 1-3 menit): <a href="${url}" target="_blank">${url}</a>`, true);
            }

        } catch (error) {
            log(`❌ ERROR: ${error.message}`);
        } finally {
            tombolLoading(deployBtn, false, "Jalankan Deploy!");
        }
    }

    // ==========================================
    // 2. FUNGSI HAPUS PROJECT (MANUAL KILL)
    // ==========================================
    async function hapusRepo() {
        const token = document.getElementById('ghToken').value.trim();
        const repoName = document.getElementById('repoName').value.trim();

        if (!token || !repoName) {
            alert("Harap isi PAT dan Nama Repository yang ingin dihapus!");
            return;
        }

        const konfirmasi = confirm(`🚨 PERINGATAN!\n\nApakah Anda yakin ingin menghapus repository "${repoName}" secara permanen? URL akan langsung mati.`);
        if (!konfirmasi) return;

        tombolLoading(deleteBtn, true);
        logArea.innerHTML = ''; 

        const headers = {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'X-GitHub-Api-Version': '2022-11-28'
        };

        try {
            log("Memeriksa akun GitHub...");
            const userRes = await fetch('https://api.github.com/user', { headers });
            if (!userRes.ok) throw new Error("Token tidak valid!");
            const username = (await userRes.json()).login;

            log(`Mencoba menghapus repository: ${repoName}...`);
            const delRes = await fetch(`https://api.github.com/repos/${username}/${repoName}`, {
                method: 'DELETE',
                headers
            });

            if (delRes.status === 204) {
                log(`✅ Repository ${repoName} berhasil dihapus permanen!`);
                log("URL website sudah tidak bisa diakses lagi.");
            } else if (delRes.status === 403 || delRes.status === 404) {
                throw new Error("Gagal menghapus. Pastikan nama repo benar dan PAT Anda memiliki scope 'delete_repo' yang dicentang.");
            } else {
                throw new Error(`Gagal (Status: ${delRes.status})`);
            }
        } catch (error) {
            log(`❌ ERROR: ${error.message}`);
        } finally {
            tombolLoading(deleteBtn, false, "Hapus Repository Ini Sekarang");
        }
    }

    // ==========================================
    // FUNGSI UTILITIES & PARTIKEL
    // ==========================================
    function tombolLoading(btn, isLoading, originalText = "") {
        const textSpan = btn.querySelector('.btn-text');
        const loader = btn.querySelector('.loader');
        
        btn.disabled = isLoading;
        if (isLoading) {
            textSpan.style.display = 'none';
            loader.style.display = 'inline-block';
        } else {
            textSpan.style.display = 'inline-block';
            textSpan.textContent = originalText;
            loader.style.display = 'none';
        }
    }

    // Animasi Canvas
    const canvas = document.getElementById('particles-bg');
    const ctx = canvas.getContext('2d');
    let particlesArray;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        initParticles();
    });

    class Particle {
        constructor(x, y, directionX, directionY, size, color) {
            this.x = x; this.y = y; this.directionX = directionX;
            this.directionY = directionY; this.size = size; this.color = color;
        }
        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2, false);
            ctx.fillStyle = this.color; ctx.fill();
        }
        update() {
            if (this.x > canvas.width || this.x < 0) this.directionX = -this.directionX;
            if (this.y > canvas.height || this.y < 0) this.directionY = -this.directionY;
            this.x += this.directionX; this.y += this.directionY;
            this.draw();
        }
    }

    function initParticles() {
        particlesArray = [];
        const numberOfParticles = (canvas.height * canvas.width) / 9000;
        for (let i = 0; i < numberOfParticles; i++) {
            const size = (Math.random() * 2) + 1;
            const x = (Math.random() * ((innerWidth - size * 2) - (size * 2)) + size * 2);
            const y = (Math.random() * ((innerHeight - size * 2) - (size * 2)) + size * 2);
            const directionX = (Math.random() * 1) - 0.5;
            const directionY = (Math.random() * 1) - 0.5;
            particlesArray.push(new Particle(x, y, directionX, directionY, size, 'rgba(255, 255, 255, 0.15)'));
        }
    }

    function animateParticles() {
        requestAnimationFrame(animateParticles);
        ctx.clearRect(0, 0, innerWidth, innerHeight);
        for (let i = 0; i < particlesArray.length; i++) particlesArray[i].update();
    }

    initParticles(); 
    animateParticles();
});
