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
   تعمل بالطريقتين:
   1. Render باستخدام Environment Variables
   2. الجهاز المحلي باستخدام الملفات
========================================================= */

function getOAuthClientData() {

    /* ---------------------------------------------
       الطريقة الأولى: Environment Variables
       تستخدم على Render
    --------------------------------------------- */

    if (
        process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET
    ) {

        console.log(
            "استخدام بيانات Google OAuth من متغيرات البيئة."
        );

        return {

            client_id:
                process.env.GOOGLE_CLIENT_ID,

            client_secret:
                process.env.GOOGLE_CLIENT_SECRET,

            redirect_uris: []

        };
    }

    /* ---------------------------------------------
       الطريقة الثانية: google-oauth.json
       تستخدم محليًا
    --------------------------------------------- */

    if (!fs.existsSync(GOOGLE_OAUTH_FILE)) {

        throw new Error(
            "بيانات Google OAuth غير موجودة. أضف GOOGLE_CLIENT_ID و GOOGLE_CLIENT_SECRET في Render."
        );
    }

    const credentials =
        JSON.parse(
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

    const config =
        getOAuthClientData();

    /* ---------------------------------------------
       Render:
       استخدام Refresh Token من Environment
    --------------------------------------------- */

    if (
        process.env.GOOGLE_REFRESH_TOKEN
    ) {

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

        /* ---------------------------------------------
           اختبار الاتصال فعليًا
        --------------------------------------------- */

        await oauth2Client.getAccessToken();

        drive =
            google.drive({

                version:
                    "v3",

                auth:
                    oauth2Client

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

            drive =
                google.drive({

                    version:
                        "v3",

                    auth:
                        oauth2Client

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

            scopes:
                GOOGLE_SCOPES,

            keyfilePath:
                GOOGLE_OAUTH_FILE

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

    drive =
        google.drive({

            version:
                "v3",

            auth:
                auth

        });

    console.log(
        "تم الاتصال بـ Google Drive بنجاح."
    );
}

/* =========================================================
   MULTER
========================================================= */

const upload =
    multer({

        storage:
            multer.memoryStorage(),

        limits: {

            fileSize:
                100 * 1024 * 1024

        },

        fileFilter:
            function (
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
                    file.originalname
                        .toLowerCase();

                const isPdf =
                    file.mimetype ===
                        "application/pdf" ||
                    fileName.endsWith(
                        ".pdf"
                    );

                if (isPdf) {

                    cb(
                        null,
                        true
                    );

                } else {

                    cb(
                        new Error(
                            "الملف المختار ليس ملف PDF صالحًا."
                        )
                    );
                }
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

                success:
                    false,

                status:
                    401,

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

                success:
                    false,

                status:
                    401,

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

                success:
                    false,

                status:
                    401,

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

                success:
                    false,

                status:
                    403,

                message:
                    "لم يتم العثور على ملف المستخدم."

            };
        }

        return {

            success:
                true,

            user:
                user,

            profile:
                profile

        };

    } catch (error) {

        console.error(
            "verifyUser error:",
            error
        );

        return {

            success:
                false,

            status:
                500,

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

            success:
                false,

            status:
                403,

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

            success:
                false,

            status:
                403,

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

                        success:
                            false,

                        message:
                            result.error.message

                    });
            }

            return res.json({

                success:
                    true,

                message:
                    "تم الاتصال بـ Supabase بنجاح."

            });

        } catch (error) {

            console.error(
                error
            );

            return res
                .status(500)
                .json({

                    success:
                        false,

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

                        success:
                            false,

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

                        success:
                            false,

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

                        success:
                            false,

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

                        success:
                            false,

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

                        success:
                            false,

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

                        success:
                            false,

                        message:
                            "تم إنشاء الحساب لكن حدث خطأ أثناء حفظ بياناته."

                    });
            }

            return res.json({

                success:
                    true,

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

                    success:
                        false,

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

                        success:
                            false,

                        message:
                            verification.message

                    });
            }

            const result =
                await supabase.auth.admin
                    .listUsers({

                        page:
                            1,

                        perPage:
                            1000

                    });

            if (result.error) {

                return res
                    .status(500)
                    .json({

                        success:
                            false,

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

                        success:
                            false,

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

                success:
                    true,

                users:
                    users

            });

        } catch (error) {

            console.error(
                "Get users error:",
                error
            );

            return res
                .status(500)
                .json({

                    success:
                        false,

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

                        success:
                            false,

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

                        success:
                            false,

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

                        success:
                            false,

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

                        success:
                            false,

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

                        success:
                            false,

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

                            success:
                                false,

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

                            success:
                                false,

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

                            success:
                                false,

                            message:
                                updateProfileResult
                                    .error
                                    .message

                        });
                }
            }

            return res.json({

                success:
                    true,

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

                    success:
                        false,

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

                        success:
                            false,

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

                        success:
                            false,

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

                        success:
                            false,

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

                        success:
                            false,

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

                        success:
                            false,

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

                        success:
                            false,

                        message:
                            "تم حذف بيانات الحساب لكن حدث خطأ أثناء حذف حساب تسجيل الدخول."

                    });
            }

            return res.json({

                success:
                    true,

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

                    success:
                        false,

                    message:
                        "حدث خطأ داخلي في الخادم."

                });
        }
    }
);

/* =========================================================
   رفع كتاب PDF
========================================================= */

app.post(
    "/api/books/upload",
    upload.single("pdf"),
    async function (
        req,
        res
    ) {

        let uploadedFileId =
            null;

        try {

            console.log(
                "================================="
            );

            console.log(
                "بدأ طلب رفع كتاب"
            );

            console.log(
                "REQ FILE:",
                req.file
                    ? {

                        name:
                            req.file.originalname,

                        mimetype:
                            req.file.mimetype,

                        size:
                            req.file.size

                    }
                    : null
            );

            console.log(
                "REQ BODY:",
                req.body
            );

            console.log(
                "================================="
            );

            if (!drive) {

                return res
                    .status(500)
                    .json({

                        success:
                            false,

                        message:
                            "Google Drive غير متصل بالخادم."

                    });
            }

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

                        success:
                            false,

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

                        success:
                            false,

                        message:
                            "ليس لديك صلاحية لرفع الكتب."

                    });
            }

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

                        success:
                            false,

                        message:
                            "يرجى إدخال عنوان الكتاب."

                    });
            }

            if (!category) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        message:
                            "يرجى اختيار تصنيف الكتاب."

                    });
            }

            if (!req.file) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        message:
                            "يرجى اختيار ملف PDF."

                    });
            }

            const uploadedFileName =
                req.file.originalname
                    .toLowerCase();

            const isPdf =
                req.file.mimetype ===
                    "application/pdf" ||
                uploadedFileName.endsWith(
                    ".pdf"
                );

            if (!isPdf) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        message:
                            "يسمح برفع ملفات PDF فقط."

                    });
            }

            const folderId =
                process.env
                    .GOOGLE_DRIVE_FOLDER_ID;

            if (!folderId) {

                return res
                    .status(500)
                    .json({

                        success:
                            false,

                        message:
                            "لم يتم إعداد مجلد Google Drive في الخادم."

                    });
            }

            const safeFileName =
                path.basename(
                    req.file.originalname
                );

            const fileMetadata = {

                name:
                    safeFileName,

                parents: [
                    folderId
                ]

            };

            const media = {

                mimeType:
                    "application/pdf",

                body:
                    Readable.from(
                        req.file.buffer
                    )

            };

            console.log(
                "بدء رفع الملف إلى Google Drive..."
            );

            const uploadedFile =
                await drive.files.create({

                    requestBody:
                        fileMetadata,

                    media:
                        media,

                    fields:
                        "id,name,webViewLink,webContentLink"

                });

            uploadedFileId =
                uploadedFile.data.id;

            if (!uploadedFileId) {

                return res
                    .status(500)
                    .json({

                        success:
                            false,

                        message:
                            "تم رفع الملف لكن لم يتم الحصول على معرفه."

                    });
            }

            console.log(
                "تم رفع الملف. ID:",
                uploadedFileId
            );

            try {

                await drive.permissions.create({

                    fileId:
                        uploadedFileId,

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
                    "خطأ في صلاحيات Google Drive:",
                    permissionError
                );

                try {

                    await drive.files.delete({

                        fileId:
                            uploadedFileId

                    });

                } catch (deleteError) {

                    console.error(
                        "تعذر حذف الملف بعد فشل الصلاحيات:",
                        deleteError
                    );
                }

                uploadedFileId =
                    null;

                return res
                    .status(500)
                    .json({

                        success:
                            false,

                        message:
                            "تم رفع الكتاب لكن تعذر إعداد رابط القراءة."

                    });
            }

            const webViewLink =
                uploadedFile.data.webViewLink ||
                "https://drive.google.com/file/d/" +
                uploadedFileId +
                "/view";

            console.log(
                "جاري حفظ بيانات الكتاب في Supabase..."
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
                            null,

                        drive_file_id:
                            uploadedFileId,

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

                try {

                    await drive.files.delete({

                        fileId:
                            uploadedFileId

                    });

                    console.log(
                        "تم حذف الملف من Google Drive بعد فشل حفظ بياناته."
                    );

                } catch (deleteError) {

                    console.error(
                        "تعذر حذف الملف من Google Drive:",
                        deleteError
                    );
                }

                uploadedFileId =
                    null;

                return res
                    .status(500)
                    .json({

                        success:
                            false,

                        message:
                            "تم رفع الملف لكن حدث خطأ أثناء حفظ بيانات الكتاب في قاعدة البيانات."

                    });
            }

            const book =
                bookResult.data;

            console.log(
                "تم حفظ الكتاب في Supabase بنجاح. ID:",
                book.id
            );

            return res.json({

                success:
                    true,

                message:
                    "تم رفع الكتاب وحفظه في المكتبة بنجاح.",

                bookId:
                    book.id,

                book:
                    book,

                fileId:
                    uploadedFileId,

                webViewLink:
                    webViewLink

            });

        } catch (error) {

            console.error(
                "Google Drive / Supabase upload error:"
            );

            console.error(
                error
            );

            if (
                uploadedFileId &&
                drive
            ) {

                try {

                    await drive.files.delete({

                        fileId:
                            uploadedFileId

                    });

                    console.log(
                        "تم حذف الملف من Google Drive بعد حدوث الخطأ."
                    );

                } catch (deleteError) {

                    console.error(
                        "تعذر حذف الملف بعد الخطأ:",
                        deleteError
                    );
                }
            }

            return res
                .status(500)
                .json({

                    success:
                        false,

                    message:
                        "حدث خطأ أثناء رفع الكتاب.",

                    error:
                        error.message

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

                        success:
                            false,

                        message:
                            "تعذر جلب الكتب من قاعدة البيانات."

                    });
            }

            return res.json({

                success:
                    true,

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

                    success:
                        false,

                    message:
                        "حدث خطأ أثناء جلب الكتب."

                });
        }
    }
);

/* =========================================================
   فتح PDF
   محمي بتسجيل الدخول من الخادم
========================================================= */

app.get(
    "/api/books/:id/pdf",
    async function (
        req,
        res
    ) {

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

                        success:
                            false,

                        message:
                            verification.message

                    });
            }

            const bookId =
                req.params.id;

            if (!bookId) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

                        message:
                            "معرف الكتاب غير صالح."

                    });
            }

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

                        success:
                            false,

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

                        success:
                            false,

                        message:
                            "ملف PDF غير مرتبط بهذا الكتاب."

                    });
            }

            if (!drive) {

                return res
                    .status(500)
                    .json({

                        success:
                            false,

                        message:
                            "Google Drive غير متصل بالخادم."

                    });
            }

            console.log(
                "جاري إرسال PDF:",
                book.title
            );

            const driveResponse =
                await drive.files.get({

                    fileId:
                        book.drive_file_id,

                    alt:
                        "media"

                }, {

                    responseType:
                        "stream"

                });

            res.setHeader(
                "Content-Type",
                "application/pdf"
            );

            res.setHeader(
                "Content-Disposition",
                'inline; filename="book.pdf"'
            );

            res.setHeader(
                "Cache-Control",
                "private, max-age=3600"
            );

            driveResponse.data.pipe(
                res
            );

            driveResponse.data.on(
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
                            .json({

                                success:
                                    false,

                                message:
                                    "حدث خطأ أثناء قراءة ملف PDF."

                            });

                    } else {

                        res.end();
                    }
                }
            );

        } catch (error) {

            console.error(
                "PDF reader error:",
                error
            );

            if (
                !res.headersSent
            ) {

                return res
                    .status(500)
                    .json({

                        success:
                            false,

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

                        success:
                            false,

                        message:
                            "حجم ملف PDF يتجاوز 100 ميغابايت."

                    });
            }

            return res
                .status(400)
                .json({

                    success:
                        false,

                    message:
                        "حدث خطأ أثناء استقبال ملف PDF."

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

                    success:
                        false,

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