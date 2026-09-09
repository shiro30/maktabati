require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");

const { createClient } = require("@supabase/supabase-js");
const { google } = require("googleapis");
const { authenticate } = require("@google-cloud/local-auth");

const multer = require("multer");
const { Readable } = require("stream");

const app = express();

const PORT = process.env.PORT || 3000;

/* =========================================================
SUPABASE
========================================================= */

if (!process.env.SUPABASE_URL) {
    console.error(
        "خطأ: SUPABASE_URL غير موجود في متغيرات البيئة."
    );
    process.exit(1);
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
        "خطأ: SUPABASE_SERVICE_ROLE_KEY غير موجود في متغيرات البيئة."
    );
    process.exit(1);
}

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* =========================================================
GOOGLE DRIVE
========================================================= */

const GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/drive"
];

const GOOGLE_OAUTH_FILE = path.join(
    __dirname,
    "google-oauth.json"
);

const GOOGLE_TOKEN_FILE = path.join(
    __dirname,
    "token.json"
);

let drive = null;

/* =========================================================
قراءة بيانات Google OAuth
========================================================= */

function getOAuthClientData() {
    if (
        process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET
    ) {
        console.log(
            "استخدام بيانات Google OAuth من متغيرات البيئة."
        );

        return {
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            redirect_uris: []
        };
    }

    if (!fs.existsSync(GOOGLE_OAUTH_FILE)) {
        throw new Error(
            "بيانات Google OAuth غير موجودة. أضف GOOGLE_CLIENT_ID و GOOGLE_CLIENT_SECRET في Render."
        );
    }

    const credentials = JSON.parse(
        fs.readFileSync(
            GOOGLE_OAUTH_FILE,
            "utf8"
        )
    );

    const config =
        credentials.installed ||
        credentials.web;

    if (!config) {
        throw new Error(
            "ملف google-oauth.json غير صالح."
        );
    }

    return config;
}

/* =========================================================
الاتصال بـ Google Drive
========================================================= */

async function authorizeGoogleDrive() {
    const config = getOAuthClientData();

    /* ---------------------------------------------
       Render:
       استخدام Refresh Token
    --------------------------------------------- */

    if (process.env.GOOGLE_REFRESH_TOKEN) {
        console.log(
            "جاري الاتصال بـ Google Drive باستخدام Refresh Token..."
        );

        const oauth2Client =
            new google.auth.OAuth2(
                config.client_id,
                config.client_secret,
                config.redirect_uris &&
                config.redirect_uris.length > 0
                    ? config.redirect_uris[0]
                    : undefined
            );

        oauth2Client.setCredentials({
            refresh_token:
                process.env.GOOGLE_REFRESH_TOKEN
        });

        await oauth2Client.getAccessToken();

        drive = google.drive({
            version: "v3",
            auth: oauth2Client
        });

        console.log(
            "تم الاتصال بـ Google Drive بنجاح."
        );

        return;
    }

    /* ---------------------------------------------
       التشغيل المحلي:
       استخدام token.json
    --------------------------------------------- */

    if (
        fs.existsSync(
            GOOGLE_TOKEN_FILE
        )
    ) {
        try {
            const savedCredentials =
                JSON.parse(
                    fs.readFileSync(
                        GOOGLE_TOKEN_FILE,
                        "utf8"
                    )
                );

            const oauth2Client =
                new google.auth.OAuth2(
                    config.client_id,
                    config.client_secret,
                    config.redirect_uris
                        ? config.redirect_uris[0]
                        : undefined
                );

            oauth2Client.setCredentials(
                savedCredentials
            );

            drive = google.drive({
                version: "v3",
                auth: oauth2Client
            });

            console.log(
                "تم تحميل جلسة Google Drive المحفوظة."
            );

            return;
        } catch (error) {
            console.log(
                "تعذر استخدام token.json."
            );

            console.log(
                "سيتم طلب تسجيل الدخول إلى Google من جديد."
            );
        }
    }

    /* ---------------------------------------------
       تسجيل الدخول لأول مرة محليًا
    --------------------------------------------- */

    console.log(
        "لم يتم العثور على جلسة Google محفوظة."
    );

    console.log(
        "سيتم فتح نافذة تسجيل الدخول إلى Google..."
    );

    const auth =
        await authenticate({
            scopes: GOOGLE_SCOPES,
            keyfilePath: GOOGLE_OAUTH_FILE
        });

    /* ---------------------------------------------
       حفظ جلسة OAuth
    --------------------------------------------- */

    if (
        auth.credentials &&
        auth.credentials.refresh_token
    ) {
        fs.writeFileSync(
            GOOGLE_TOKEN_FILE,
            JSON.stringify(
                auth.credentials,
                null,
                2
            )
        );

        console.log(
            "تم حفظ جلسة Google في token.json."
        );
    }

    drive = google.drive({
        version: "v3",
        auth: auth
    });

    console.log(
        "تم الاتصال بـ Google Drive بنجاح."
    );
}

/* =========================================================
MULTER
استقبال PDF + صورة الغلاف
========================================================= */

const upload = multer({
    storage: multer.memoryStorage(),

    limits: {
        fileSize:
            100 * 1024 * 1024,
        files: 2
    },

    fileFilter: function (
        req,
        file,
        cb
    ) {
        console.log(
            "================================="
        );

        console.log(
            "استقبال ملف جديد"
        );

        console.log(
            "الحقل:",
            file.fieldname
        );

        console.log(
            "اسم الملف:",
            file.originalname
        );

        console.log(
            "نوع الملف:",
            file.mimetype
        );

        console.log(
            "================================="
        );

        const fileName =
            file.originalname.toLowerCase();

        /* ---------------------------------------------
           ملف PDF
        --------------------------------------------- */

        if (
            file.fieldname === "pdf"
        ) {
            const isPdf =
                file.mimetype ===
                    "application/pdf" ||
                fileName.endsWith(".pdf");

            if (isPdf) {
                cb(null, true);
            } else {
                cb(
                    new Error(
                        "ملف الكتاب يجب أن يكون بصيغة PDF."
                    )
                );
            }

            return;
        }

        /* ---------------------------------------------
           صورة الغلاف
        --------------------------------------------- */

        if (
            file.fieldname === "cover"
        ) {
            const allowedCoverTypes = [
                "image/jpeg",
                "image/png",
                "image/webp"
            ];

            const isCover =
                allowedCoverTypes.includes(
                    file.mimetype
                );

            if (isCover) {
                cb(null, true);
            } else {
                cb(
                    new Error(
                        "غلاف الكتاب يجب أن يكون JPG أو PNG أو WebP."
                    )
                );
            }

            return;
        }

        cb(
            new Error(
                "نوع الملف غير مسموح."
            )
        );
    }
});

/* =========================================================
EXPRESS
========================================================= */

app.use(
    express.json({
        limit: "10mb"
    })
);

app.use(
    express.urlencoded({
        extended: true
    })
);

app.use(
    express.static(__dirname)
);

/* =========================================================
الصفحة الرئيسية
========================================================= */

app.get(
    "/",
    function (
        req,
        res
    ) {
        res.sendFile(
            path.join(
                __dirname,
                "index.html"
            )
        );
    }
);

/* =========================================================
التحقق من المستخدم
========================================================= */

async function verifyUser(req) {
    try {
        const authorization =
            req.headers.authorization;

        if (!authorization) {
            return {
                success: false,
                status: 401,
                message:
                    "يجب تسجيل الدخول أولًا."
            };
        }

        const token =
            authorization
                .replace(
                    /^Bearer\s+/i,
                    ""
                )
                .trim();

        if (!token) {
            return {
                success: false,
                status: 401,
                message:
                    "جلسة تسجيل الدخول غير صالحة."
            };
        }

        const result =
            await supabase.auth.getUser(
                token
            );

        const user =
            result.data.user;

        const userError =
            result.error;

        if (
            userError ||
            !user
        ) {
            return {
                success: false,
                status: 401,
                message:
                    "جلسة تسجيل الدخول غير صالحة."
            };
        }

        const profileResult =
            await supabase
                .from("profiles")
                .select(
                    "id, full_name, role"
                )
                .eq(
                    "id",
                    user.id
                )
                .single();

        const profile =
            profileResult.data;

        const profileError =
            profileResult.error;

        if (
            profileError ||
            !profile
        ) {
            return {
                success: false,
                status: 403,
                message:
                    "لم يتم العثور على ملف المستخدم."
            };
        }

        return {
            success: true,
            user: user,
            profile: profile
        };

    } catch (error) {
        console.error(
            "verifyUser error:",
            error
        );

        return {
            success: false,
            status: 500,
            message:
                "حدث خطأ أثناء التحقق من المستخدم."
        };
    }
}

/* =========================================================
التحقق من المبرمج
========================================================= */

async function verifyProgrammer(req) {
    const verification =
        await verifyUser(req);

    if (
        !verification.success
    ) {
        return verification;
    }

    if (
        verification.profile.role !==
        "programmer"
    ) {
        return {
            success: false,
            status: 403,
            message:
                "ليس لديك صلاحية لتنفيذ هذه العملية."
        };
    }

    return verification;
}

/* =========================================================
التحقق من المبرمج أو المدير
========================================================= */

async function verifyAccountManager(req) {
    const verification =
        await verifyUser(req);

    if (
        !verification.success
    ) {
        return verification;
    }

    const role =
        verification.profile.role;

    if (
        role !== "programmer" &&
        role !== "admin"
    ) {
        return {
            success: false,
            status: 403,
            message:
                "ليس لديك صلاحية لإدارة الحسابات."
        };
    }

    return verification;
}

/* =========================================================
اختبار Supabase
========================================================= */

app.get(
    "/api/test-supabase",
    async function (
        req,
        res
    ) {
        try {
            const result =
                await supabase
                    .from("profiles")
                    .select("id")
                    .limit(1);

            if (result.error) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            result.error.message
                    });
            }

            return res.json({
                success: true,
                message:
                    "تم الاتصال بـ Supabase بنجاح."
            });

        } catch (error) {
            console.error(error);

            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        error.message
                });
        }
    }
);

/* =========================================================
إنشاء مستخدم
========================================================= */

app.post(
    "/api/admin/create-user",
    async function (
        req,
        res
    ) {
        try {
            const {
                fullName,
                email,
                password,
                role
            } = req.body;

            if (
                !fullName ||
                !email ||
                !password ||
                !role
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "يرجى ملء جميع الحقول."
                    });
            }

            if (
                password.length < 6
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "كلمة المرور يجب أن تحتوي على 6 أحرف على الأقل."
                    });
            }

            if (
                ![
                    "admin",
                    "teacher",
                    "student"
                ].includes(role)
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "نوع الحساب غير مسموح."
                    });
            }

            const verification =
                await verifyAccountManager(
                    req
                );

            if (
                !verification.success
            ) {
                return res
                    .status(
                        verification.status
                    )
                    .json({
                        success: false,
                        message:
                            verification.message
                    });
            }

            const result =
                await supabase.auth.admin
                    .createUser({
                        email:
                            email
                                .trim()
                                .toLowerCase(),

                        password:
                            password,

                        email_confirm:
                            true
                    });

            if (result.error) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            result.error.message
                    });
            }

            const newUser =
                result.data.user;

            const profileResult =
                await supabase
                    .from("profiles")
                    .insert({
                        id:
                            newUser.id,

                        full_name:
                            fullName.trim(),

                        role:
                            role
                    });

            if (
                profileResult.error
            ) {
                await supabase.auth.admin
                    .deleteUser(
                        newUser.id
                    );

                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "تم إنشاء الحساب لكن حدث خطأ أثناء حفظ بياناته."
                    });
            }

            return res.json({
                success: true,

                message:
                    "تم إنشاء الحساب بنجاح.",

                user: {
                    id:
                        newUser.id,

                    email:
                        newUser.email,

                    fullName:
                        fullName.trim(),

                    role:
                        role
                }
            });

        } catch (error) {
            console.error(
                "Create user error:",
                error
            );

            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        "حدث خطأ داخلي في الخادم."
                });
        }
    }
);

/* =========================================================
جلب المستخدمين
========================================================= */

app.get(
    "/api/admin/users",
    async function (
        req,
        res
    ) {
        try {
            const verification =
                await verifyAccountManager(
                    req
                );

            if (
                !verification.success
            ) {
                return res
                    .status(
                        verification.status
                    )
                    .json({
                        success: false,
                        message:
                            verification.message
                    });
            }

            const result =
                await supabase.auth.admin
                    .listUsers({
                        page: 1,
                        perPage: 1000
                    });

            if (result.error) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            result.error.message
                    });
            }

            const usersData =
                result.data.users;

            const profilesResult =
                await supabase
                    .from("profiles")
                    .select(
                        "id, full_name, role, created_at"
                    );

            if (
                profilesResult.error
            ) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            profilesResult.error.message
                    });
            }

            const profiles =
                profilesResult.data ||
                [];

            const users =
                usersData.map(
                    function (
                        user
                    ) {
                        const profile =
                            profiles.find(
                                function (
                                    p
                                ) {
                                    return (
                                        p.id ===
                                        user.id
                                    );
                                }
                            );

                        return {
                            id:
                                user.id,

                            email:
                                user.email,

                            fullName:
                                profile
                                    ? profile.full_name
                                    : "بدون اسم",

                            role:
                                profile
                                    ? profile.role
                                    : "غير محدد",

                            createdAt:
                                profile
                                    ? profile.created_at
                                    : user.created_at,

                            emailConfirmed:
                                !!user.email_confirmed_at
                        };
                    }
                );

            return res.json({
                success: true,
                users: users
            });

        } catch (error) {
            console.error(
                "Get users error:",
                error
            );

            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        "حدث خطأ داخلي في الخادم."
                });
        }
    }
);

/* =========================================================
تعديل مستخدم
========================================================= */

app.put(
    "/api/admin/users/:id",
    async function (
        req,
        res
    ) {
        try {
            const userId =
                req.params.id;

            const {
                fullName,
                email,
                password,
                role
            } = req.body;

            const verification =
                await verifyAccountManager(
                    req
                );

            if (
                !verification.success
            ) {
                return res
                    .status(
                        verification.status
                    )
                    .json({
                        success: false,
                        message:
                            verification.message
                    });
            }

            const targetResult =
                await supabase
                    .from("profiles")
                    .select(
                        "id, full_name, role"
                    )
                    .eq(
                        "id",
                        userId
                    )
                    .single();

            if (
                targetResult.error ||
                !targetResult.data
            ) {
                return res
                    .status(404)
                    .json({
                        success: false,
                        message:
                            "الحساب غير موجود."
                    });
            }

            const targetProfile =
                targetResult.data;

            if (
                targetProfile.role ===
                "programmer"
            ) {
                return res
                    .status(403)
                    .json({
                        success: false,
                        message:
                            "حساب المبرمج محمي ولا يمكن تعديله."
                    });
            }

            if (
                role === "programmer"
            ) {
                return res
                    .status(403)
                    .json({
                        success: false,
                        message:
                            "لا يمكن إنشاء أو تحويل حساب إلى مبرمج."
                    });
            }

            if (
                role &&
                ![
                    "admin",
                    "teacher",
                    "student"
                ].includes(role)
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "نوع الحساب غير مسموح."
                    });
            }

            const authUpdates = {};

            if (
                email &&
                email.trim() !== ""
            ) {
                authUpdates.email =
                    email
                        .trim()
                        .toLowerCase();

                authUpdates.email_confirm =
                    true;
            }

            if (
                password &&
                password.length > 0
            ) {
                if (
                    password.length < 6
                ) {
                    return res
                        .status(400)
                        .json({
                            success: false,
                            message:
                                "كلمة المرور يجب أن تحتوي على 6 أحرف على الأقل."
                        });
                }

                authUpdates.password =
                    password;
            }

            if (
                Object.keys(
                    authUpdates
                ).length > 0
            ) {
                const updateAuthResult =
                    await supabase.auth.admin
                        .updateUserById(
                            userId,
                            authUpdates
                        );

                if (
                    updateAuthResult.error
                ) {
                    return res
                        .status(400)
                        .json({
                            success: false,
                            message:
                                updateAuthResult
                                    .error
                                    .message
                        });
                }
            }

            const profileUpdates = {};

            if (
                fullName &&
                fullName.trim() !== ""
            ) {
                profileUpdates.full_name =
                    fullName.trim();
            }

            if (role) {
                profileUpdates.role =
                    role;
            }

            if (
                Object.keys(
                    profileUpdates
                ).length > 0
            ) {
                const updateProfileResult =
                    await supabase
                        .from("profiles")
                        .update(
                            profileUpdates
                        )
                        .eq(
                            "id",
                            userId
                        );

                if (
                    updateProfileResult.error
                ) {
                    return res
                        .status(500)
                        .json({
                            success: false,
                            message:
                                updateProfileResult
                                    .error
                                    .message
                        });
                }
            }

            return res.json({
                success: true,
                message:
                    "تم تعديل الحساب بنجاح."
            });

        } catch (error) {
            console.error(
                "Update user error:",
                error
            );

            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        "حدث خطأ داخلي في الخادم."
                });
        }
    }
);

/* =========================================================
حذف مستخدم
========================================================= */

app.delete(
    "/api/admin/users/:id",
    async function (
        req,
        res
    ) {
        try {
            const userId =
                req.params.id;

            const verification =
                await verifyAccountManager(
                    req
                );

            if (
                !verification.success
            ) {
                return res
                    .status(
                        verification.status
                    )
                    .json({
                        success: false,
                        message:
                            verification.message
                    });
            }

            if (
                userId ===
                verification.user.id
            ) {
                return res
                    .status(403)
                    .json({
                        success: false,
                        message:
                            "لا يمكنك حذف حسابك الحالي."
                    });
            }

            const targetResult =
                await supabase
                    .from("profiles")
                    .select(
                        "id, role"
                    )
                    .eq(
                        "id",
                        userId
                    )
                    .single();

            if (
                targetResult.error ||
                !targetResult.data
            ) {
                return res
                    .status(404)
                    .json({
                        success: false,
                        message:
                            "الحساب غير موجود."
                    });
            }

            const targetProfile =
                targetResult.data;

            if (
                targetProfile.role ===
                "programmer"
            ) {
                return res
                    .status(403)
                    .json({
                        success: false,
                        message:
                            "لا يمكن حذف حساب المبرمج."
                    });
            }

            const deleteProfileResult =
                await supabase
                    .from("profiles")
                    .delete()
                    .eq(
                        "id",
                        userId
                    );

            if (
                deleteProfileResult.error
            ) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            deleteProfileResult
                                .error
                                .message
                    });
            }

            const deleteUserResult =
                await supabase.auth.admin
                    .deleteUser(
                        userId
                    );

            if (
                deleteUserResult.error
            ) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "تم حذف بيانات الحساب لكن حدث خطأ أثناء حذف حساب تسجيل الدخول."
                    });
            }

            return res.json({
                success: true,
                message:
                    "تم حذف الحساب بنجاح."
            });

        } catch (error) {
            console.error(
                "Delete user error:",
                error
            );

            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        "حدث خطأ داخلي في الخادم."
                });
        }
    }
);

/* =========================================================
رفع كتاب PDF + غلاف
========================================================= */

app.post(
    "/api/books/upload",

    upload.fields([
        {
            name: "pdf",
            maxCount: 1
        },
        {
            name: "cover",
            maxCount: 1
        }
    ]),

    async function (
        req,
        res
    ) {
        let uploadedPdfId = null;
        let uploadedCoverId = null;

        try {
            console.log(
                "================================="
            );

            console.log(
                "بدأ طلب رفع كتاب + غلاف"
            );

            console.log(
                "================================="
            );

            const pdfFile =
                req.files &&
                req.files.pdf
                    ? req.files.pdf[0]
                    : null;

            const coverFile =
                req.files &&
                req.files.cover
                    ? req.files.cover[0]
                    : null;

            console.log(
                "PDF:",
                pdfFile
                    ? {
                        name:
                            pdfFile.originalname,
                        mimetype:
                            pdfFile.mimetype,
                        size:
                            pdfFile.size
                    }
                    : null
            );

            console.log(
                "Cover:",
                coverFile
                    ? {
                        name:
                            coverFile.originalname,
                        mimetype:
                            coverFile.mimetype,
                        size:
                            coverFile.size
                    }
                    : null
            );

            console.log(
                "REQ BODY:",
                req.body
            );

            /* ---------------------------------------------
               التحقق من Google Drive
            --------------------------------------------- */

            if (!drive) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "Google Drive غير متصل بالخادم."
                    });
            }

            /* ---------------------------------------------
               التحقق من المستخدم
            --------------------------------------------- */

            const verification =
                await verifyUser(req);

            if (
                !verification.success
            ) {
                return res
                    .status(
                        verification.status
                    )
                    .json({
                        success: false,
                        message:
                            verification.message
                    });
            }

            const role =
                verification.profile.role;

            if (
                role !== "programmer" &&
                role !== "admin" &&
                role !== "teacher"
            ) {
                return res
                    .status(403)
                    .json({
                        success: false,
                        message:
                            "ليس لديك صلاحية لرفع الكتب."
                    });
            }

            /* ---------------------------------------------
               البيانات
            --------------------------------------------- */

            const title =
                req.body.title
                    ? req.body.title.trim()
                    : "";

            const author =
                req.body.author
                    ? req.body.author.trim()
                    : "";

            const category =
                req.body.category
                    ? req.body.category.trim()
                    : "";

            const description =
                req.body.description
                    ? req.body.description.trim()
                    : "";

            if (!title) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "يرجى إدخال عنوان الكتاب."
                    });
            }

            if (!category) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "يرجى اختيار تصنيف الكتاب."
                    });
            }

            /* ---------------------------------------------
               التأكد من وجود PDF
            --------------------------------------------- */

            if (!pdfFile) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "يرجى اختيار ملف PDF."
                    });
            }

            /* ---------------------------------------------
               التأكد من وجود الغلاف
            --------------------------------------------- */

            if (!coverFile) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "يرجى اختيار صورة غلاف الكتاب."
                    });
            }

            /* ---------------------------------------------
               التحقق من PDF
            --------------------------------------------- */

            const uploadedFileName =
                pdfFile.originalname
                    .toLowerCase();

            const isPdf =
                pdfFile.mimetype ===
                    "application/pdf" ||
                uploadedFileName.endsWith(
                    ".pdf"
                );

            if (!isPdf) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "يسمح برفع ملفات PDF فقط."
                    });
            }

            /* ---------------------------------------------
               حجم PDF
            --------------------------------------------- */

            const MAX_PDF_SIZE =
                100 *
                1024 *
                1024;

            if (
                pdfFile.size >
                MAX_PDF_SIZE
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "حجم ملف PDF يتجاوز 100 ميغابايت."
                    });
            }

            /* ---------------------------------------------
               التحقق من الغلاف
            --------------------------------------------- */

            const allowedCoverTypes = [
                "image/jpeg",
                "image/png",
                "image/webp"
            ];

            if (
                !allowedCoverTypes.includes(
                    coverFile.mimetype
                )
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "غلاف الكتاب يجب أن يكون JPG أو PNG أو WebP."
                    });
            }

            /* ---------------------------------------------
               حجم الغلاف
            --------------------------------------------- */

            const MAX_COVER_SIZE =
                10 *
                1024 *
                1024;

            if (
                coverFile.size >
                MAX_COVER_SIZE
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "حجم صورة الغلاف يتجاوز 10 ميغابايت."
                    });
            }

            /* ---------------------------------------------
               مجلد Google Drive
            --------------------------------------------- */

            const folderId =
                process.env
                    .GOOGLE_DRIVE_FOLDER_ID;

            if (!folderId) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "لم يتم إعداد مجلد Google Drive في الخادم."
                    });
            }

            /* =================================================
               رفع PDF
            ================================================= */

            const safePdfFileName =
                path.basename(
                    pdfFile.originalname
                );

            const pdfMetadata = {
                name:
                    safePdfFileName,

                parents: [
                    folderId
                ]
            };

            const pdfMedia = {
                mimeType:
                    "application/pdf",

                body:
                    Readable.from(
                        pdfFile.buffer
                    )
            };

            console.log(
                "بدء رفع ملف PDF إلى Google Drive..."
            );

            const uploadedPdf =
                await drive.files.create({
                    requestBody:
                        pdfMetadata,

                    media:
                        pdfMedia,

                    fields:
                        "id,name,webViewLink,webContentLink"
                });

            uploadedPdfId =
                uploadedPdf.data.id;

            if (!uploadedPdfId) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "تم رفع ملف PDF لكن لم يتم الحصول على معرفه."
                    });
            }

            console.log(
                "تم رفع PDF. ID:",
                uploadedPdfId
            );

            /* ---------------------------------------------
               جعل PDF قابلًا للقراءة
            --------------------------------------------- */

            try {
                await drive.permissions.create({
                    fileId:
                        uploadedPdfId,

                    requestBody: {
                        role:
                            "reader",

                        type:
                            "anyone"
                    },

                    fields:
                        "id"
                });

            } catch (permissionError) {
                console.error(
                    "خطأ في صلاحيات PDF:",
                    permissionError
                );

                try {
                    await drive.files.delete({
                        fileId:
                            uploadedPdfId
                    });
                } catch (deleteError) {
                    console.error(
                        "تعذر حذف PDF بعد فشل الصلاحيات:",
                        deleteError
                    );
                }

                uploadedPdfId = null;

                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "تم رفع الكتاب لكن تعذر إعداد صلاحيات القراءة."
                    });
            }

            const webViewLink =
                uploadedPdf.data.webViewLink ||
                "https://drive.google.com/file/d/" +
                uploadedPdfId +
                "/view";

            /* =================================================
               رفع صورة الغلاف
            ================================================= */

            const safeCoverFileName =
                path.basename(
                    coverFile.originalname
                );

            const coverMetadata = {
                name:
                    "غلاف - " +
                    title +
                    " - " +
                    safeCoverFileName,

                parents: [
                    folderId
                ]
            };

            const coverMedia = {
                mimeType:
                    coverFile.mimetype,

                body:
                    Readable.from(
                        coverFile.buffer
                    )
            };

            console.log(
                "بدء رفع غلاف الكتاب إلى Google Drive..."
            );

            const uploadedCover =
                await drive.files.create({
                    requestBody:
                        coverMetadata,

                    media:
                        coverMedia,

                    fields:
                        "id,name,webViewLink,webContentLink"
                });

            uploadedCoverId =
                uploadedCover.data.id;

            if (!uploadedCoverId) {
                try {
                    await drive.files.delete({
                        fileId:
                            uploadedPdfId
                    });
                } catch (deleteError) {
                    console.error(
                        "تعذر حذف PDF:",
                        deleteError
                    );
                }

                uploadedPdfId = null;

                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "تم رفع الكتاب لكن تعذر الحصول على معرف الغلاف."
                    });
            }

            console.log(
                "تم رفع الغلاف. ID:",
                uploadedCoverId
            );

            /* ---------------------------------------------
               جعل الغلاف قابلًا للعرض
            --------------------------------------------- */

            try {
                await drive.permissions.create({
                    fileId:
                        uploadedCoverId,

                    requestBody: {
                        role:
                            "reader",

                        type:
                            "anyone"
                    },

                    fields:
                        "id"
                });

            } catch (coverPermissionError) {
                console.error(
                    "خطأ في صلاحيات الغلاف:",
                    coverPermissionError
                );

                try {
                    await drive.files.delete({
                        fileId:
                            uploadedCoverId
                    });
                } catch (deleteCoverError) {
                    console.error(
                        "تعذر حذف الغلاف:",
                        deleteCoverError
                    );
                }

                try {
                    await drive.files.delete({
                        fileId:
                            uploadedPdfId
                    });
                } catch (deletePdfError) {
                    console.error(
                        "تعذر حذف PDF:",
                        deletePdfError
                    );
                }

                uploadedCoverId = null;
                uploadedPdfId = null;

                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "تم رفع الكتاب والغلاف لكن تعذر إعداد صلاحيات الغلاف."
                    });
            }

            /* ---------------------------------------------
               رابط الغلاف
            --------------------------------------------- */

            const coverUrl =
                "https://drive.google.com/thumbnail?id=" +
                uploadedCoverId +
                "&sz=w1000";

            const coverViewLink =
                uploadedCover.data.webViewLink ||
                "https://drive.google.com/file/d/" +
                uploadedCoverId +
                "/view";

            console.log(
                "رابط الغلاف:",
                coverUrl
            );

            /* =================================================
               حفظ الكتاب في Supabase
            ================================================= */

            console.log(
                "جاري حفظ بيانات الكتاب والغلاف في Supabase..."
            );

            const bookResult =
                await supabase
                    .from("books")
                    .insert({
                        title:
                            title,

                        author:
                            author || null,

                        category:
                            category,

                        description:
                            description || null,

                        cover_url:
                            coverUrl,

                        drive_file_id:
                            uploadedPdfId,

                        drive_file_url:
                            webViewLink,

                        uploaded_by:
                            verification.user.id
                    })
                    .select()
                    .single();

            if (
                bookResult.error ||
                !bookResult.data
            ) {
                console.error(
                    "Supabase book insert error:",
                    bookResult.error
                );

                if (
                    uploadedCoverId &&
                    drive
                ) {
                    try {
                        await drive.files.delete({
                            fileId:
                                uploadedCoverId
                        });

                        console.log(
                            "تم حذف الغلاف بعد فشل حفظ الكتاب."
                        );
                    } catch (deleteCoverError) {
                        console.error(
                            "تعذر حذف الغلاف:",
                            deleteCoverError
                        );
                    }
                }

                if (
                    uploadedPdfId &&
                    drive
                ) {
                    try {
                        await drive.files.delete({
                            fileId:
                                uploadedPdfId
                        });

                        console.log(
                            "تم حذف PDF بعد فشل حفظ الكتاب."
                        );
                    } catch (deletePdfError) {
                        console.error(
                            "تعذر حذف PDF:",
                            deletePdfError
                        );
                    }
                }

                uploadedCoverId = null;
                uploadedPdfId = null;

                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "تم رفع الكتاب والغلاف لكن حدث خطأ أثناء حفظ بيانات الكتاب في قاعدة البيانات."
                    });
            }

            const book =
                bookResult.data;

            console.log(
                "تم حفظ الكتاب والغلاف في Supabase بنجاح. ID:",
                book.id
            );

            console.log(
                "================================="
            );

            console.log(
                "اكتمل رفع الكتاب والغلاف بنجاح"
            );

            console.log(
                "================================="
            );

            return res.json({
                success: true,

                message:
                    "تم رفع الكتاب والغلاف بنجاح وإضافتهما إلى المكتبة.",

                bookId:
                    book.id,

                book:
                    book,

                fileId:
                    uploadedPdfId,

                coverFileId:
                    uploadedCoverId,

                webViewLink:
                    webViewLink,

                coverUrl:
                    coverUrl,

                coverViewLink:
                    coverViewLink
            });

        } catch (error) {
            console.error(
                "Google Drive / Supabase upload error:"
            );

            console.error(
                error
            );

            /* ---------------------------------------------
               تنظيف PDF
            --------------------------------------------- */

            if (
                uploadedPdfId &&
                drive
            ) {
                try {
                    await drive.files.delete({
                        fileId:
                            uploadedPdfId
                    });

                    console.log(
                        "تم حذف PDF بعد حدوث الخطأ."
                    );

                } catch (deleteError) {
                    console.error(
                        "تعذر حذف PDF بعد الخطأ:",
                        deleteError
                    );
                }
            }

            /* ---------------------------------------------
               تنظيف الغلاف
            --------------------------------------------- */

            if (
                uploadedCoverId &&
                drive
            ) {
                try {
                    await drive.files.delete({
                        fileId:
                            uploadedCoverId
                    });

                    console.log(
                        "تم حذف الغلاف بعد حدوث الخطأ."
                    );

                } catch (deleteError) {
                    console.error(
                        "تعذر حذف الغلاف بعد الخطأ:",
                        deleteError
                    );
                }
            }

            return res
                .status(500)
                .json({
                    success: false,

                    message:
                        "حدث خطأ أثناء رفع الكتاب والغلاف.",

                    error:
                        error.message
                });
        }
    }
);

/* =========================================================
حذف كتاب + غلاف
========================================================= */

app.delete(
    "/api/books/:id",
    async function (
        req,
        res
    ) {
        try {
            console.log(
                "================================="
            );

            console.log(
                "بدأ طلب حذف كتاب"
            );

            console.log(
                "Book ID:",
                req.params.id
            );

            console.log(
                "================================="
            );

            /* ---------------------------------------------
               التحقق من المستخدم
            --------------------------------------------- */

            const verification =
                await verifyUser(req);

            if (
                !verification.success
            ) {
                return res
                    .status(
                        verification.status
                    )
                    .json({
                        success: false,
                        message:
                            verification.message
                    });
            }

            const currentUser =
                verification.user;

            const currentRole =
                verification.profile.role;

            /* ---------------------------------------------
               منع الطالب
            --------------------------------------------- */

            if (
                currentRole !== "programmer" &&
                currentRole !== "admin" &&
                currentRole !== "teacher"
            ) {
                return res
                    .status(403)
                    .json({
                        success: false,
                        message:
                            "ليس لديك صلاحية حذف الكتب."
                    });
            }

            const bookId =
                req.params.id;

            if (!bookId) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "معرف الكتاب غير صالح."
                    });
            }

            /* ---------------------------------------------
               جلب الكتاب
            --------------------------------------------- */

            const bookResult =
                await supabase
                    .from("books")
                    .select(
                        "id, title, drive_file_id, cover_url, uploaded_by"
                    )
                    .eq(
                        "id",
                        bookId
                    )
                    .single();

            if (
                bookResult.error ||
                !bookResult.data
            ) {
                console.error(
                    "Get book for deletion error:",
                    bookResult.error
                );

                return res
                    .status(404)
                    .json({
                        success: false,
                        message:
                            "الكتاب غير موجود."
                    });
            }

            const book =
                bookResult.data;

            /* ---------------------------------------------
               الأستاذ يستطيع حذف كتابه فقط
            --------------------------------------------- */

            if (
                currentRole === "teacher" &&
                book.uploaded_by !==
                    currentUser.id
            ) {
                return res
                    .status(403)
                    .json({
                        success: false,
                        message:
                            "يمكن للأستاذ حذف الكتب التي رفعها بنفسه فقط."
                    });
            }

            /* ---------------------------------------------
               التأكد من Google Drive
            --------------------------------------------- */

            if (
                (
                    book.drive_file_id ||
                    book.cover_url
                ) &&
                !drive
            ) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "Google Drive غير متصل بالخادم، لم يتم حذف الكتاب."
                    });
            }

            /* ---------------------------------------------
               حذف PDF
            --------------------------------------------- */

            let pdfDeleted = false;

            if (
                book.drive_file_id &&
                drive
            ) {
                try {
                    console.log(
                        "جاري حذف ملف PDF من Google Drive..."
                    );

                    await drive.files.delete({
                        fileId:
                            book.drive_file_id
                    });

                    pdfDeleted = true;

                    console.log(
                        "تم حذف ملف PDF من Google Drive."
                    );

                } catch (driveError) {
                    const driveStatus =
                        driveError &&
                        driveError.response
                            ? driveError.response.status
                            : null;

                    if (
                        driveStatus === 404
                    ) {
                        console.log(
                            "ملف PDF غير موجود في Google Drive."
                        );

                        pdfDeleted = true;

                    } else {
                        console.error(
                            "خطأ أثناء حذف ملف PDF:",
                            driveError
                        );

                        return res
                            .status(500)
                            .json({
                                success: false,
                                message:
                                    "تعذر حذف ملف الكتاب من Google Drive، لذلك لم يتم حذف الكتاب من المكتبة."
                            });
                    }
                }
            }

            /* ---------------------------------------------
               استخراج ID الغلاف
            --------------------------------------------- */

            let coverFileId = null;

            if (
                book.cover_url
            ) {
                try {
                    const coverUrl =
                        new URL(
                            book.cover_url
                        );

                    coverFileId =
                        coverUrl.searchParams.get(
                            "id"
                        );
                } catch (urlError) {
                    console.log(
                        "تعذر استخراج معرف الغلاف من الرابط."
                    );
                }
            }

            /* ---------------------------------------------
               حذف الغلاف
            --------------------------------------------- */

            let coverDeleted = false;

            if (
                coverFileId &&
                drive
            ) {
                try {
                    console.log(
                        "جاري حذف غلاف الكتاب من Google Drive..."
                    );

                    await drive.files.delete({
                        fileId:
                            coverFileId
                    });

                    coverDeleted = true;

                    console.log(
                        "تم حذف غلاف الكتاب من Google Drive."
                    );

                } catch (coverError) {
                    const coverStatus =
                        coverError &&
                        coverError.response
                            ? coverError.response.status
                            : null;

                    if (
                        coverStatus === 404
                    ) {
                        console.log(
                            "غلاف الكتاب غير موجود في Google Drive."
                        );

                        coverDeleted = true;

                    } else {
                        console.error(
                            "خطأ أثناء حذف الغلاف:",
                            coverError
                        );

                        return res
                            .status(500)
                            .json({
                                success: false,
                                message:
                                    "تم التعامل مع ملف الكتاب لكن تعذر حذف غلافه من Google Drive، لذلك لم يتم حذف الكتاب من المكتبة."
                            });
                    }
                }
            }

            /* ---------------------------------------------
               حذف سجل الكتاب من Supabase
            --------------------------------------------- */

            console.log(
                "جاري حذف سجل الكتاب من Supabase..."
            );

            const deleteBookResult =
                await supabase
                    .from("books")
                    .delete()
                    .eq(
                        "id",
                        bookId
                    );

            if (
                deleteBookResult.error
            ) {
                console.error(
                    "Delete book from Supabase error:",
                    deleteBookResult.error
                );

                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "تم حذف ملفات الكتاب من Google Drive لكن حدث خطأ أثناء حذف سجل الكتاب من قاعدة البيانات."
                    });
            }

            console.log(
                "تم حذف الكتاب من Supabase بنجاح."
            );

            console.log(
                "================================="
            );

            console.log(
                "اكتمل حذف الكتاب:",
                book.title
            );

            console.log(
                "PDF deleted:",
                pdfDeleted
            );

            console.log(
                "Cover deleted:",
                coverDeleted
            );

            console.log(
                "================================="
            );

            return res.json({
                success: true,

                message:
                    "تم حذف الكتاب والغلاف بنجاح.",

                bookId:
                    book.id,

                title:
                    book.title
            });

        } catch (error) {
            console.error(
                "Delete book error:",
                error
            );

            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        "حدث خطأ داخلي أثناء حذف الكتاب."
                });
        }
    }
);

/* =========================================================
جلب جميع الكتب
========================================================= */

app.get(
    "/api/books",
    async function (
        req,
        res
    ) {
        try {
            const result =
                await supabase
                    .from("books")
                    .select(
                        `
                        id,
                        title,
                        author,
                        category,
                        description,
                        cover_url,
                        drive_file_id,
                        drive_file_url,
                        uploaded_by,
                        created_at,
                        updated_at
                        `
                    )
                    .order(
                        "created_at",
                        {
                            ascending:
                                false
                        }
                    );

            if (result.error) {
                console.error(
                    "Get books error:",
                    result.error
                );

                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "تعذر جلب الكتب من قاعدة البيانات."
                    });
            }

            return res.json({
                success: true,
                books:
                    result.data || []
            });

        } catch (error) {
            console.error(
                "Books API error:",
                error
            );

            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        "حدث خطأ أثناء جلب الكتب."
                });
        }
    }
);

/* =========================================================
فتح PDF
محمي بتسجيل الدخول
يدعم HTTP RANGE REQUESTS
لتحميل PDF بشكل تدريجي مع PDF.js
========================================================= */

app.get(
    "/api/books/:id/pdf",
    async function (
        req,
        res
    ) {
        let driveStream = null;

        try {
            /* ---------------------------------------------
               التحقق من تسجيل الدخول
            --------------------------------------------- */

            const verification =
                await verifyUser(req);

            if (
                !verification.success
            ) {
                return res
                    .status(
                        verification.status
                    )
                    .json({
                        success: false,
                        message:
                            verification.message
                    });
            }

            /* ---------------------------------------------
               التحقق من معرف الكتاب
            --------------------------------------------- */

            const bookId =
                req.params.id;

            if (!bookId) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "معرف الكتاب غير صالح."
                    });
            }

            /* ---------------------------------------------
               جلب بيانات الكتاب
            --------------------------------------------- */

            const bookResult =
                await supabase
                    .from("books")
                    .select(
                        "id, title, drive_file_id"
                    )
                    .eq(
                        "id",
                        bookId
                    )
                    .single();

            if (
                bookResult.error ||
                !bookResult.data
            ) {
                return res
                    .status(404)
                    .json({
                        success: false,
                        message:
                            "الكتاب غير موجود."
                    });
            }

            const book =
                bookResult.data;

            if (
                !book.drive_file_id
            ) {
                return res
                    .status(404)
                    .json({
                        success: false,
                        message:
                            "ملف PDF غير مرتبط بهذا الكتاب."
                    });
            }

            /* ---------------------------------------------
               التأكد من Google Drive
            --------------------------------------------- */

            if (!drive) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "Google Drive غير متصل بالخادم."
                    });
            }

            console.log(
                "================================="
            );

            console.log(
                "طلب PDF للكتاب:",
                book.title
            );

            console.log(
                "Range:",
                req.headers.range || "بدون Range"
            );

            /* ---------------------------------------------
               الحصول على حجم ملف PDF
            --------------------------------------------- */

            const metadataResponse =
                await drive.files.get({
                    fileId:
                        book.drive_file_id,

                    fields:
                        "id,name,size,mimeType"
                });

            const fileSize =
                Number(
                    metadataResponse.data.size
                );

            if (
                !Number.isFinite(fileSize) ||
                fileSize <= 0
            ) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "تعذر معرفة حجم ملف PDF."
                    });
            }

            /* ---------------------------------------------
               اسم آمن للملف
            --------------------------------------------- */

            const safeTitle =
                (
                    book.title ||
                    "book"
                )
                    .replace(
                        /[\/\\:*?"<>|]/g,
                        "_"
                    )
                    .trim() ||
                "book";

            /* ---------------------------------------------
               إعداد رؤوس الاستجابة
            --------------------------------------------- */

            res.setHeader(
                "Content-Type",
                "application/pdf"
            );

            res.setHeader(
                "Content-Disposition",
                `inline; filename*=UTF-8''${encodeURIComponent(
                    safeTitle
                )}.pdf`
            );

            res.setHeader(
                "Accept-Ranges",
                "bytes"
            );

            res.setHeader(
                "Cache-Control",
                "private, max-age=3600"
            );

            /* =================================================
               لا يوجد Range
               إرسال الملف كاملًا كـ Stream
            ================================================= */

            if (!req.headers.range) {
                console.log(
                    "إرسال PDF كاملًا:"
                );

                console.log(
                    "الحجم:",
                    fileSize,
                    "bytes"
                );

                res.setHeader(
                    "Content-Length",
                    String(fileSize)
                );

                const driveResponse =
                    await drive.files.get(
                        {
                            fileId:
                                book.drive_file_id,

                            alt:
                                "media"
                        },
                        {
                            responseType:
                                "stream"
                        }
                    );

                driveStream =
                    driveResponse.data;

                driveStream.on(
                    "error",
                    function (
                        error
                    ) {
                        console.error(
                            "PDF stream error:",
                            error
                        );

                        if (
                            !res.headersSent
                        ) {
                            res
                                .status(500)
                                .end();
                        } else {
                            res.end();
                        }
                    }
                );

                req.on(
                    "close",
                    function () {
                        if (
                            driveStream &&
                            !driveStream.destroyed
                        ) {
                            driveStream.destroy();
                        }
                    }
                );

                driveStream.pipe(
                    res
                );

                return;
            }

            /* =================================================
               يوجد Range
            ================================================= */

            const rangeHeader =
                req.headers.range;

            const rangeMatch =
                rangeHeader.match(
                    /^bytes=(\d*)-(\d*)$/
                );

            if (!rangeMatch) {
                res.setHeader(
                    "Content-Range",
                    `bytes */${fileSize}`
                );

                return res
                    .status(416)
                    .end();
            }

            let start =
                rangeMatch[1] !== ""
                    ? Number(
                        rangeMatch[1]
                    )
                    : null;

            let end =
                rangeMatch[2] !== ""
                    ? Number(
                        rangeMatch[2]
                    )
                    : null;

            /* ---------------------------------------------
               Range من النهاية
               مثال: bytes=-500000
            --------------------------------------------- */

            if (
                start === null &&
                end !== null
            ) {
                const suffixLength =
                    end;

                if (
                    suffixLength <= 0
                ) {
                    res.setHeader(
                        "Content-Range",
                        `bytes */${fileSize}`
                    );

                    return res
                        .status(416)
                        .end();
                }

                start =
                    Math.max(
                        fileSize -
                            suffixLength,
                        0
                    );

                end =
                    fileSize - 1;
            }

            /* ---------------------------------------------
               Range مفتوح
               مثال: bytes=500000-
            --------------------------------------------- */

            if (
                start !== null &&
                end === null
            ) {
                end =
                    fileSize - 1;
            }

            /* ---------------------------------------------
               التحقق من الحدود
            --------------------------------------------- */

            if (
                start === null ||
                end === null ||
                !Number.isInteger(start) ||
                !Number.isInteger(end) ||
                start < 0 ||
                end < 0 ||
                start >= fileSize ||
                start > end
            ) {
                res.setHeader(
                    "Content-Range",
                    `bytes */${fileSize}`
                );

                return res
                    .status(416)
                    .end();
            }

            /* ---------------------------------------------
               منع تجاوز نهاية الملف
            --------------------------------------------- */

            if (
                end >= fileSize
            ) {
                end =
                    fileSize - 1;
            }

            const chunkSize =
                end - start + 1;

            console.log(
                "إرسال Range:",
                start,
                "-",
                end
            );

            console.log(
                "حجم الجزء:",
                chunkSize,
                "bytes"
            );

            /* ---------------------------------------------
               إعداد استجابة 206
            --------------------------------------------- */

            res.status(206);

            res.setHeader(
                "Content-Range",
                `bytes ${start}-${end}/${fileSize}`
            );

            res.setHeader(
                "Content-Length",
                String(chunkSize)
            );

            res.setHeader(
                "Accept-Ranges",
                "bytes"
            );

            /* ---------------------------------------------
               طلب الجزء المطلوب من Google Drive
            --------------------------------------------- */

            const driveResponse =
                await drive.files.get(
                    {
                        fileId:
                            book.drive_file_id,

                        alt:
                            "media"
                    },
                    {
                        responseType:
                            "stream",

                        headers: {
                            Range:
                                `bytes=${start}-${end}`
                        }
                    }
                );

            driveStream =
                driveResponse.data;

            /* ---------------------------------------------
               مراقبة أخطاء Stream
            --------------------------------------------- */

            driveStream.on(
                "error",
                function (
                    error
                ) {
                    console.error(
                        "Google Drive Range stream error:",
                        error
                    );

                    if (
                        !res.headersSent
                    ) {
                        res
                            .status(500)
                            .end();
                    } else {
                        res.end();
                    }
                }
            );

            /* ---------------------------------------------
               إذا أغلق العميل الاتصال
               نوقف تحميل الجزء من Google Drive
            --------------------------------------------- */

            req.on(
                "close",
                function () {
                    if (
                        driveStream &&
                        !driveStream.destroyed
                    ) {
                        driveStream.destroy();
                    }
                }
            );

            /* ---------------------------------------------
               إرسال الجزء للمتصفح
            --------------------------------------------- */

            driveStream.pipe(
                res
            );

        } catch (error) {
            console.error(
                "PDF reader error:",
                error
            );

            if (
                driveStream &&
                !driveStream.destroyed
            ) {
                driveStream.destroy();
            }

            if (
                !res.headersSent
            ) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "تعذر فتح ملف PDF.",
                        error:
                            error.message
                    });
            }

            res.end();
        }
    }
);

/* =========================================================
معالجة أخطاء MULTER
========================================================= */

app.use(
    function (
        error,
        req,
        res,
        next
    ) {
        if (
            error instanceof
            multer.MulterError
        ) {
            if (
                error.code ===
                "LIMIT_FILE_SIZE"
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "حجم الملف يتجاوز الحد المسموح به."
                    });
            }

            if (
                error.code ===
                "LIMIT_UNEXPECTED_FILE"
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "تم إرسال ملف غير متوقع."
                    });
            }

            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "حدث خطأ أثناء استقبال الملفات."
                });
        }

        if (error) {
            console.error(
                "Server error:",
                error
            );

            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        error.message ||
                        "حدث خطأ داخلي في الخادم."
                });
        }

        next();
    }
);

/* =========================================================
تشغيل الخادم
========================================================= */

async function startServer() {
    try {
        console.log(
            "جاري الاتصال بـ Google Drive..."
        );

        await authorizeGoogleDrive();

        app.listen(
            PORT,
            "0.0.0.0",
            function () {
                console.log(
                    "=========================================="
                );

                console.log(
                    "مكتبة الثانوية تعمل بنجاح"
                );

                console.log(
                    "Port: " + PORT
                );

                console.log(
                    "Google Drive: متصل"
                );

                console.log(
                    "Supabase: متصل"
                );

                console.log(
                    "نظام أغلفة الكتب: مفعّل"
                );

                console.log(
                    "نظام تحميل PDF التدريجي: مفعّل"
                );

                console.log(
                    "HTTP Range Requests: مفعّل"
                );

                console.log(
                    "=========================================="
                );
            }
        );

    } catch (error) {
        console.error(
            "=========================================="
        );

        console.error(
            "فشل الاتصال بـ Google Drive"
        );

        console.error(
            error.message
        );

        console.error(
            "=========================================="
        );

        process.exit(1);
    }
}

startServer();