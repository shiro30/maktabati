require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");

const { createClient } = require("@supabase/supabase-js");
const { google } = require("googleapis");
const { authenticate } = require("@google-cloud/local-auth");

const multer = require("multer");
const { Readable } = require("stream");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================================================
   SUPABASE
========================================================= */

if (!process.env.SUPABASE_URL) {
    console.error("خطأ: SUPABASE_URL غير موجود في متغيرات البيئة.");
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
        fs.readFileSync(GOOGLE_OAUTH_FILE, "utf8")
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

    if (fs.existsSync(GOOGLE_TOKEN_FILE)) {
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
   PDF + صورة الغلاف
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
   MULTER - ملفات منصة المؤسسة
========================================================= */

const platformUpload = multer({
    storage: multer.memoryStorage(),

    limits: {
        fileSize:
            100 * 1024 * 1024,
        files: 1
    },

    fileFilter: function (
        req,
        file,
        cb
    ) {
        const fileName =
            file.originalname.toLowerCase();

        if (
            file.fieldname === "pdf" &&
            (
                file.mimetype === "application/pdf" ||
                fileName.endsWith(".pdf")
            )
        ) {
            return cb(null, true);
        }

        cb(
            new Error(
                "ملفات منصة المؤسسة يجب أن تكون بصيغة PDF."
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
    function (req, res) {
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
                    "id, full_name, role, subject"
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

        const metadata =
            user.user_metadata || {};

        profile.branch =
            profile.branch ||
            metadata.branch ||
            null;

        profile.year =
            profile.year ||
            metadata.year ||
            null;

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

    if (!verification.success) {
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

    if (!verification.success) {
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
   التحقق من صلاحيات منصة المؤسسة
========================================================= */

async function verifyPlatformUser(req) {
    const verification =
        await verifyUser(req);

    if (!verification.success) {
        return verification;
    }

    const profile =
        verification.profile;

    const role =
        profile.role;

    /*
       المبرمج والمدير:
       صلاحية كاملة في جميع مواد المنصة.
    */

    if (
        role === "programmer" ||
        role === "admin"
    ) {
        return {
            success: true,
            user: verification.user,
            profile: profile,
            fullAccess: true,
            readOnly: false
        };
    }

    /*
       الأستاذ:
       صلاحية كاملة داخل مادته فقط.
    */

    if (role === "teacher") {
        if (
            !profile.subject ||
            !String(profile.subject).trim()
        ) {
            return {
                success: false,
                status: 403,
                message:
                    "لم يتم تحديد المادة الخاصة بهذا الأستاذ."
            };
        }

        return {
            success: true,
            user: verification.user,
            profile: profile,
            fullAccess: false,
            readOnly: false,
            teacherSubject:
                String(profile.subject).trim()
        };
    }

    /*
       التلميذ:
       مشاهدة فقط.
    */

    if (role === "student") {
        const studentBranch =
            String(profile.branch || "").trim();

        const studentYear =
            Number(profile.year);

        if (
            !studentBranch ||
            ![1, 2, 3].includes(studentYear)
        ) {
            return {
                success: false,
                status: 403,
                message:
                    "لم يتم تحديد الشعبة والسنة الدراسية لحساب التلميذ."
            };
        }

        return {
            success: true,
            user: verification.user,
            profile: profile,
            fullAccess: false,
            readOnly: true,
            studentBranch: studentBranch,
            studentYear: studentYear
        };
    }

    return {
        success: false,
        status: 403,
        message:
            "ليس لديك صلاحية للدخول إلى منصة المؤسسة."
    };
}

/* =========================================================
   التحقق من أن الأستاذ يعمل داخل مادته فقط
========================================================= */

function teacherCanAccessSubject(
    verification,
    subject
) {
    if (
        verification.fullAccess
    ) {
        return true;
    }

    if (
        verification.profile.role ===
        "teacher"
    ) {
        return (
            String(subject || "").trim() ===
            String(
                verification.teacherSubject || ""
            ).trim()
        );
    }

    /*
       التلميذ يستطيع المشاهدة.
    */

    if (
        verification.profile.role ===
        "student"
    ) {
        return true;
    }

    return false;
}

/* =========================================================
   التحقق من بيانات موقع المنصة
========================================================= */

function validatePlatformLocation(
    branch,
    year,
    subject
) {
    const allowedBranches = [
        "scientific",
        "literature",
        "management"
    ];

    if (
        !allowedBranches.includes(
            branch
        )
    ) {
        return {
            valid: false,
            message:
                "الشعبة غير صالحة."
        };
    }

    const numericYear =
        Number(year);

    if (
        ![1, 2, 3].includes(
            numericYear
        )
    ) {
        return {
            valid: false,
            message:
                "السنة الدراسية غير صالحة."
        };
    }

    if (
        !subject ||
        !String(subject).trim()
    ) {
        return {
            valid: false,
            message:
                "المادة غير محددة."
        };
    }

    return {
        valid: true,
        branch: branch,
        year: numericYear,
        subject:
            String(subject).trim()
    };
}

/* =========================================================
   إنشاء رقم وثيقة رسمي
========================================================= */

function generateDocumentNumber() {
    const year =
        new Date().getFullYear();

    const randomPart =
        crypto
            .randomBytes(5)
            .toString("hex")
            .toUpperCase();

    return (
        "MKT-" +
        year +
        "-" +
        randomPart
    );
}

/* =========================================================
   اختبار Supabase
========================================================= */

app.get(
    "/api/test-supabase",
    async function (req, res) {
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
   إنشاء مستخدم + إصدار وثيقة تسجيل
========================================================= */

app.post(
    "/api/admin/create-user",
    async function (req, res) {
        try {
            const {
                fullName,
                email,
                password,
                role,
                subject,
                branch,
                year
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

            const cleanFullName =
                String(fullName).trim();

            const cleanEmail =
                String(email)
                    .trim()
                    .toLowerCase();

            const cleanPassword =
                String(password);

            const cleanSubject =
                subject
                    ? String(subject).trim()
                    : "";

            const cleanBranch =
                branch ? String(branch).trim() : "";

            const cleanYear =
                Number(year);

            if (
                cleanFullName.length < 2
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "الاسم غير صالح."
                    });
            }

            if (
                cleanPassword.length < 6
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

            if (
                role === "teacher" &&
                !cleanSubject
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "يرجى اختيار المادة التي يدرّسها الأستاذ."
                    });
            }

            const finalSubject =
                role === "teacher"
                    ? cleanSubject
                    : null;

            if (role === "student") {
                if (!["scientific", "literature", "management"].includes(cleanBranch)) {
                    return res.status(400).json({
                        success: false,
                        message: "يرجى اختيار شعبة التلميذ."
                    });
                }
                if (![1, 2, 3].includes(cleanYear) || (cleanBranch === "management" && cleanYear === 1)) {
                    return res.status(400).json({
                        success: false,
                        message: "يرجى اختيار سنة دراسية صحيحة للتلميذ."
                    });
                }
            }

            const verification =
                await verifyAccountManager(
                    req
                );

            if (!verification.success) {
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
                            cleanEmail,

                        password:
                            cleanPassword,

                        email_confirm:
                            true,

                        user_metadata: {
                            full_name: cleanFullName,
                            branch: role === "student" ? cleanBranch : null,
                            year: role === "student" ? cleanYear : null
                        }
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
                            cleanFullName,

                        role:
                            role,

                        subject:
                            finalSubject
                    });

            if (profileResult.error) {
                await supabase.auth.admin
                    .deleteUser(
                        newUser.id
                    );

                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            profileResult.error?.message ||
                            "تم إنشاء الحساب لكن حدث خطأ أثناء حفظ بياناته."
                    });
            }

            let documentNumber =
                generateDocumentNumber();

            let documentResult = null;

            for (
                let attempt = 0;
                attempt < 5;
                attempt++
            ) {
                documentNumber =
                    generateDocumentNumber();

                documentResult =
                    await supabase
                        .from(
                            "registration_documents"
                        )
                        .insert({
                            user_id:
                                newUser.id,

                            document_number:
                                documentNumber,

                            issued_by:
                                verification.user.id,

                            status:
                                "issued"
                        })
                        .select(
                            "id, user_id, document_number, issued_by, issued_at, status, created_at"
                        )
                        .single();

                if (
                    !documentResult.error
                ) {
                    break;
                }

                const errorMessage =
                    documentResult.error
                        .message || "";

                if (
                    !errorMessage
                        .toLowerCase()
                        .includes("duplicate")
                ) {
                    break;
                }
            }

            if (
                !documentResult ||
                documentResult.error ||
                !documentResult.data
            ) {
                console.error(
                    "Registration document error:",
                    documentResult
                        ? documentResult.error
                        : "Unknown error"
                );

                await supabase
                    .from("profiles")
                    .delete()
                    .eq(
                        "id",
                        newUser.id
                    );

                await supabase.auth.admin
                    .deleteUser(
                        newUser.id
                    );

                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            (documentResult?.error?.message
                                ? `تعذر إصدار وثيقة التسجيل: ${documentResult.error.message}`
                                : "تعذر إصدار وثيقة التسجيل، لذلك لم يتم إنشاء الحساب.")
                    });
            }

            const registrationDocument =
                documentResult.data;

            return res.json({
                success: true,

                message:
                    "تم إنشاء الحساب وإصدار وثيقة التسجيل بنجاح.",

                user: {
                    id:
                        newUser.id,

                    email:
                        newUser.email,

                    fullName:
                        cleanFullName,

                    role:
                        role,

                    subject:
                        finalSubject
                },

                registrationDocument: {
                    id:
                        registrationDocument.id,

                    documentNumber:
                        registrationDocument
                            .document_number,

                    issuedAt:
                        registrationDocument
                            .issued_at,

                    status:
                        registrationDocument
                            .status,

                    fullName:
                        cleanFullName,

                    email:
                        cleanEmail,

                    password:
                        cleanPassword,

                    role:
                        role,

                    subject:
                        finalSubject,

                    issuedBy:
                        verification.profile
                            .full_name,

                    libraryUrl:
                        "https://maktabati-1-rpeo.onrender.com"
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
                        error?.message ||
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
    async function (req, res) {
        try {
            const verification =
                await verifyAccountManager(
                    req
                );

            if (!verification.success) {
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
                        "id, full_name, role, subject, created_at"
                    );

            if (profilesResult.error) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            profilesResult
                                .error
                                .message
                    });
            }

            const profiles =
                profilesResult.data || [];

            const users =
                usersData.map(
                    function (user) {
                        const profile =
                            profiles.find(
                                function (p) {
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

                            subject:
                                profile
                                    ? profile.subject || null
                                    : null,

                            branch:
                                user.user_metadata?.branch || null,

                            year:
                                user.user_metadata?.year || null,

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
                    success: false,
                    message:
                        "حدث خطأ داخلي في الخادم."
                });
        }
    }
);

/* =========================================================
   معلومات وثيقة مستخدم
========================================================= */

app.get(
    "/api/admin/users/:id/registration-document",
    async function (req, res) {
        try {
            const verification =
                await verifyAccountManager(
                    req
                );

            if (!verification.success) {
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

            const userId =
                req.params.id;

            const documentResult =
                await supabase
                    .from(
                        "registration_documents"
                    )
                    .select(
                        `
                        id,
                        user_id,
                        document_number,
                        issued_by,
                        issued_at,
                        status,
                        created_at
                        `
                    )
                    .eq(
                        "user_id",
                        userId
                    )
                    .order(
                        "created_at",
                        {
                            ascending:
                                false
                        }
                    )
                    .limit(1)
                    .maybeSingle();

            if (
                documentResult.error
            ) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            documentResult
                                .error
                                .message
                    });
            }

            if (
                !documentResult.data
            ) {
                return res
                    .status(404)
                    .json({
                        success: false,
                        message:
                            "لا توجد وثيقة تسجيل لهذا الحساب."
                    });
            }

            const profileResult =
                await supabase
                    .from("profiles")
                    .select(
                        "id, full_name, role, subject"
                    )
                    .eq(
                        "id",
                        userId
                    )
                    .single();

            if (
                profileResult.error ||
                !profileResult.data
            ) {
                return res
                    .status(404)
                    .json({
                        success: false,
                        message:
                            "لم يتم العثور على بيانات المستخدم."
                    });
            }

            const authResult =
                await supabase.auth.admin
                    .getUserById(
                        userId
                    );

            if (authResult.error) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            authResult
                                .error
                                .message
                    });
            }

            return res.json({
                success: true,

                document:
                    documentResult.data,

                user: {
                    id:
                        userId,

                    fullName:
                        profileResult.data
                            .full_name,

                    email:
                        authResult.data.user
                            .email,

                    role:
                        profileResult.data
                            .role,

                    subject:
                        profileResult.data
                            .subject || null
                }
            });

        } catch (error) {
            console.error(
                "Get registration document error:",
                error
            );

            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        "حدث خطأ أثناء جلب وثيقة التسجيل."
                });
        }
    }
);

/* =========================================================
   تعديل مستخدم
========================================================= */

app.put(
    "/api/admin/users/:id",
    async function (req, res) {
        try {
            const userId =
                req.params.id;

            const {
                fullName,
                email,
                password,
                role,
                subject,
                branch,
                year
            } = req.body;

            const verification =
                await verifyAccountManager(
                    req
                );

            if (!verification.success) {
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
                        "id, full_name, role, subject"
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

            const finalRole =
                role || targetProfile.role;

            const cleanSubject =
                subject
                    ? String(subject).trim()
                    : "";

            if (
                finalRole === "teacher" &&
                !cleanSubject
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "يرجى اختيار المادة التي يدرّسها الأستاذ."
                    });
            }

            const finalSubject =
                finalRole === "teacher"
                    ? cleanSubject
                    : null;

            const cleanBranch =
                branch ? String(branch).trim() : "";
            const cleanYear = Number(year);

            if (finalRole === "student") {
                if (!["scientific", "literature", "management"].includes(cleanBranch)) {
                    return res.status(400).json({ success: false, message: "يرجى اختيار شعبة التلميذ." });
                }
                if (![1, 2, 3].includes(cleanYear) || (cleanBranch === "management" && cleanYear === 1)) {
                    return res.status(400).json({ success: false, message: "يرجى اختيار سنة دراسية صحيحة للتلميذ." });
                }
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

            authUpdates.user_metadata = {
                full_name:
                    fullName !== undefined
                        ? String(fullName || "").trim()
                        : targetProfile.full_name,
                branch:
                    finalRole === "student" ? cleanBranch : null,
                year:
                    finalRole === "student" ? cleanYear : null
            };

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

            profileUpdates.subject =
                finalSubject;

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
    async function (req, res) {
        try {
            const userId =
                req.params.id;

            const verification =
                await verifyAccountManager(
                    req
                );

            if (!verification.success) {
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
   منصة المؤسسة - جلب محتوى المادة
========================================================= */

app.get(
    "/api/platform/me",
    async function (req, res) {
        try {
            const verification =
                await verifyPlatformUser(req);

            if (!verification.success) {
                return res.status(verification.status).json({
                    success: false,
                    message: verification.message
                });
            }

            const metadata = verification.user.user_metadata || {};
            const profile = verification.profile || {};

            return res.json({
                success: true,
                user: {
                    id: verification.user.id,
                    email: verification.user.email || null,
                    full_name:
                        profile.full_name ||
                        metadata.full_name ||
                        metadata.name ||
                        verification.user.email ||
                        "المستخدم",
                    role: profile.role || null,
                    subject: profile.subject || null,
                    branch: profile.branch || metadata.branch || null,
                    year: profile.year || metadata.year || null
                }
            });
        } catch (error) {
            console.error("Platform current-user error:", error);
            return res.status(500).json({
                success: false,
                message: error?.message || "تعذر تحميل بيانات المستخدم."
            });
        }
    }
);

app.get(
    "/api/platform/content",
    async function (req, res) {
        try {
            const verification =
                await verifyPlatformUser(req);

            if (!verification.success) {
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

            const location =
                validatePlatformLocation(
                    req.query.branch,
                    req.query.year,
                    req.query.subject
                );

            if (!location.valid) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            location.message
                    });
            }

            if (
                verification.profile.role ===
                "teacher" &&
                !teacherCanAccessSubject(
                    verification,
                    location.subject
                )
            ) {
                return res
                    .status(403)
                    .json({
                        success: false,
                        message:
                            "لا يمكنك الوصول إلى محتوى مادة أخرى."
                    });
            }

            if (verification.profile.role === "student") {
                if (
                    verification.studentBranch !== location.branch ||
                    verification.studentYear !== location.year
                ) {
                    return res
                        .status(403)
                        .json({
                            success: false,
                            message:
                                "يمكنك مشاهدة محتوى شعبتك وسنتك الدراسية فقط."
                        });
                }
            }

            const filesResult =
                await supabase
                    .from("platform_files")
                    .select(
                        `
                        id,
                        branch,
                        year,
                        subject,
                        title,
                        description,
                        drive_file_id,
                        drive_file_url,
                        uploaded_by,
                        created_at,
                        updated_at
                        `
                    )
                    .eq(
                        "branch",
                        location.branch
                    )
                    .eq(
                        "year",
                        location.year
                    )
                    .eq(
                        "subject",
                        location.subject
                    )
                    .order(
                        "created_at",
                        {
                            ascending:
                                false
                        }
                    );

            if (filesResult.error) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            filesResult.error.message
                    });
            }

            const notesResult =
                await supabase
                    .from("platform_notes")
                    .select(
                        `
                        id,
                        branch,
                        year,
                        subject,
                        type,
                        title,
                        content,
                        created_by,
                        created_at,
                        updated_at
                        `
                    )
                    .eq(
                        "branch",
                        location.branch
                    )
                    .eq(
                        "year",
                        location.year
                    )
                    .eq(
                        "subject",
                        location.subject
                    )
                    .order(
                        "created_at",
                        {
                            ascending:
                                false
                        }
                    );

            if (notesResult.error) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            notesResult.error.message
                    });
            }

            const fileRows = filesResult.data || [];
            const noteRows = notesResult.data || [];

            const creatorIds = [
                ...fileRows.map(item => item.uploaded_by),
                ...noteRows.map(item => item.created_by)
            ].filter(Boolean);

            let creatorMap = {};

            if (creatorIds.length) {
                const creatorsResult = await supabase
                    .from("profiles")
                    .select("id, full_name")
                    .in("id", [...new Set(creatorIds)]);

                if (!creatorsResult.error) {
                    creatorMap = Object.fromEntries(
                        (creatorsResult.data || []).map(item => [
                            item.id,
                            item.full_name || "المؤسسة"
                        ])
                    );
                }
            }

            const files = fileRows.map(item => ({
                ...item,
                uploader_name:
                    creatorMap[item.uploaded_by] || "المؤسسة"
            }));

            const notes = noteRows.map(item => ({
                ...item,
                creator_name:
                    creatorMap[item.created_by] || "المؤسسة"
            }));

            return res.json({
                success: true,
                user: {
                    id: verification.user.id,
                    full_name:
                        verification.profile.full_name ||
                        verification.user.user_metadata?.full_name ||
                        verification.user.email,
                    role: verification.profile.role,
                    subject: verification.profile.subject || null,
                    branch: verification.profile.branch || null,
                    year: verification.profile.year || null
                },
                location: {
                    branch: location.branch,
                    year: location.year,
                    subject: location.subject
                },
                permissions: {
                    fullAccess: !!verification.fullAccess,
                    readOnly: !!verification.readOnly,
                    teacher: verification.profile.role === "teacher",
                    role: verification.profile.role,
                    teacherSubject: verification.teacherSubject || null,
                    studentBranch: verification.studentBranch || null,
                    studentYear: verification.studentYear || null,
                    canManageFiles:
                        !!verification.fullAccess ||
                        verification.profile.role === "teacher",
                    canManageNotes:
                        !!verification.fullAccess ||
                        verification.profile.role === "teacher"
                },
                files: files,
                notes: notes
            });

        } catch (error) {
            console.error(
                "Platform content error:",
                error
            );

            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        "حدث خطأ أثناء جلب محتوى المنصة."
                });
        }
    }
);

/* =========================================================
   منصة المؤسسة - رفع درس PDF
========================================================= */

app.post(
    "/api/platform/files/upload",

    platformUpload.single("pdf"),

    async function (req, res) {
        let uploadedFileId = null;

        try {
            const verification =
                await verifyPlatformUser(req);

            if (!verification.success) {
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
                verification.profile.role ===
                "student"
            ) {
                return res
                    .status(403)
                    .json({
                        success: false,
                        message:
                            "التلميذ لا يملك صلاحية رفع الملفات."
                    });
            }

            const location =
                validatePlatformLocation(
                    req.body.branch,
                    req.body.year,
                    req.body.subject
                );

            if (!location.valid) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            location.message
                    });
            }

            if (
                verification.profile.role ===
                "teacher" &&
                !teacherCanAccessSubject(
                    verification,
                    location.subject
                )
            ) {
                return res
                    .status(403)
                    .json({
                        success: false,
                        message:
                            "لا يمكنك رفع ملفات في مادة أخرى."
                    });
            }

            const pdfFile =
                req.file;

            if (!pdfFile) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "يرجى اختيار ملف PDF."
                    });
            }

            const title =
                req.body.title
                    ? String(
                        req.body.title
                    ).trim()
                    : "";

            const description =
                req.body.description
                    ? String(
                        req.body.description
                    ).trim()
                    : "";

            if (!title) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "يرجى إدخال عنوان الملف."
                    });
            }

            if (!drive) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "Google Drive غير متصل بالخادم."
                    });
            }

            const platformFolderId =
                process.env
                    .GOOGLE_DRIVE_FOLDER_ID;

            if (!platformFolderId) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "لم يتم إعداد مجلد Google Drive الخاص بالمنصة."
                    });
            }

            const safeFileName =
                path.basename(
                    pdfFile.originalname
                );

            const uploaded =
                await drive.files.create({
                    requestBody: {
                        name:
                            safeFileName,

                        parents: [
                            platformFolderId
                        ]
                    },

                    media: {
                        mimeType:
                            "application/pdf",

                        body:
                            Readable.from(
                                pdfFile.buffer
                            )
                    },

                    fields:
                        "id,name,webViewLink,webContentLink"
                });

            uploadedFileId =
                uploaded.data.id;

            if (!uploadedFileId) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "تعذر الحصول على معرف الملف."
                    });
            }

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

            const webViewLink =
                uploaded.data.webViewLink ||
                (
                    "https://drive.google.com/file/d/" +
                    uploadedFileId +
                    "/view"
                );

            const insertResult =
                await supabase
                    .from("platform_files")
                    .insert({
                        branch:
                            location.branch,

                        year:
                            location.year,

                        subject:
                            location.subject,

                        title:
                            title,

                        description:
                            description ||
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
                insertResult.error ||
                !insertResult.data
            ) {
                console.error(
                    "Platform file insert error:",
                    insertResult.error
                );

                try {
                    await drive.files.delete({
                        fileId:
                            uploadedFileId
                    });
                } catch (deleteError) {
                    console.error(
                        "تعذر حذف ملف المنصة:",
                        deleteError
                    );
                }

                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "تم رفع الملف لكن تعذر حفظه في قاعدة البيانات."
                    });
            }

            return res.json({
                success: true,

                message:
                    "تم رفع الملف إلى منصة المؤسسة بنجاح.",

                file:
                    insertResult.data
            });

        } catch (error) {
            console.error(
                "Platform file upload error:",
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
                    success: false,
                    message:
                        error.message ||
                        "حدث خطأ أثناء رفع ملف المنصة."
                });
        }
    }
);

/* =========================================================
   منصة المؤسسة - إضافة ملاحظة
========================================================= */

app.post(
    "/api/platform/notes",
    async function (req, res) {
        try {
            const verification =
                await verifyPlatformUser(req);

            if (!verification.success) {
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
                verification.profile.role ===
                "student"
            ) {
                return res
                    .status(403)
                    .json({
                        success: false,
                        message:
                            "التلميذ لا يستطيع إضافة الملاحظات."
                    });
            }

            const location =
                validatePlatformLocation(
                    req.body.branch,
                    req.body.year,
                    req.body.subject
                );

            if (!location.valid) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            location.message
                    });
            }

            if (
                verification.profile.role ===
                "teacher" &&
                !teacherCanAccessSubject(
                    verification,
                    location.subject
                )
            ) {
                return res
                    .status(403)
                    .json({
                        success: false,
                        message:
                            "لا يمكنك إضافة ملاحظات في مادة أخرى."
                    });
            }

            const title =
                req.body.title
                    ? String(
                        req.body.title
                    ).trim()
                    : "";

            const content =
                req.body.content
                    ? String(
                        req.body.content
                    ).trim()
                    : "";

            const rawType =
                req.body.type
                    ? String(req.body.type).trim().toLowerCase()
                    : "general";

            const type =
                rawType === "test"
                    ? "exam"
                    : rawType;

            const allowedTypes = [
                "general",
                "homework",
                "exam",
                "reminder",
                "comment"
            ];

            if (
                !allowedTypes.includes(
                    type
                )
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "نوع الملاحظة غير صالح."
                    });
            }

            if (!title || !content) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "العنوان والمحتوى مطلوبان."
                    });
            }

            const result =
                await supabase
                    .from("platform_notes")
                    .insert({
                        branch:
                            location.branch,

                        year:
                            location.year,

                        subject:
                            location.subject,

                        type:
                            type,

                        title:
                            title,

                        content:
                            content,

                        created_by:
                            verification.user.id
                    })
                    .select()
                    .single();

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
                    "تمت إضافة الملاحظة بنجاح.",

                note:
                    result.data
            });

        } catch (error) {
            console.error(
                "Platform note create error:",
                error
            );

            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        "حدث خطأ أثناء إضافة الملاحظة."
                });
        }
    }
);

/* =========================================================
   منصة المؤسسة - تعديل ملاحظة
========================================================= */

app.put(
    "/api/platform/notes/:id",
    async function (req, res) {
        try {
            const verification =
                await verifyPlatformUser(req);

            if (!verification.success) {
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
                verification.profile.role ===
                "student"
            ) {
                return res
                    .status(403)
                    .json({
                        success: false,
                        message:
                            "ليس لديك صلاحية تعديل الملاحظات."
                    });
            }

            const noteResult =
                await supabase
                    .from("platform_notes")
                    .select("*")
                    .eq(
                        "id",
                        req.params.id
                    )
                    .single();

            if (
                noteResult.error ||
                !noteResult.data
            ) {
                return res
                    .status(404)
                    .json({
                        success: false,
                        message:
                            "الملاحظة غير موجودة."
                    });
            }

            const note =
                noteResult.data;

            if (
                !teacherCanAccessSubject(
                    verification,
                    note.subject
                )
            ) {
                return res
                    .status(403)
                    .json({
                        success: false,
                        message:
                            "لا يمكنك تعديل ملاحظة تابعة لمادة أخرى."
                    });
            }

            const updates = {};

            if (
                req.body.title !==
                undefined
            ) {
                updates.title =
                    String(
                        req.body.title
                    ).trim();
            }

            if (
                req.body.content !==
                undefined
            ) {
                updates.content =
                    String(
                        req.body.content
                    ).trim();
            }

            if (
                req.body.type !==
                undefined
            ) {
                const allowedTypes = [
                    "general",
                    "homework",
                    "exam",
                    "reminder",
                    "comment"
                ];

                const rawType =
                    String(req.body.type).trim().toLowerCase();

                const type =
                    rawType === "test"
                        ? "exam"
                        : rawType;

                if (
                    !allowedTypes.includes(
                        type
                    )
                ) {
                    return res
                        .status(400)
                        .json({
                            success: false,
                            message:
                                "نوع الملاحظة غير صالح."
                        });
                }

                updates.type =
                    type;
            }

            if (
                Object.keys(
                    updates
                ).length === 0
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "لا توجد بيانات لتعديلها."
                    });
            }

            const result =
                await supabase
                    .from("platform_notes")
                    .update(
                        updates
                    )
                    .eq(
                        "id",
                        req.params.id
                    )
                    .select()
                    .single();

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
                    "تم تعديل الملاحظة بنجاح.",

                note:
                    result.data
            });

        } catch (error) {
            console.error(
                "Platform note update error:",
                error
            );

            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        "حدث خطأ أثناء تعديل الملاحظة."
                });
        }
    }
);

/* =========================================================
   منصة المؤسسة - حذف ملاحظة
========================================================= */

app.delete(
    "/api/platform/notes/:id",
    async function (req, res) {
        try {
            const verification =
                await verifyPlatformUser(req);

            if (!verification.success) {
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
                verification.profile.role ===
                "student"
            ) {
                return res
                    .status(403)
                    .json({
                        success: false,
                        message:
                            "ليس لديك صلاحية حذف الملاحظات."
                    });
            }

            const noteResult =
                await supabase
                    .from("platform_notes")
                    .select(
                        "id, subject, created_by"
                    )
                    .eq(
                        "id",
                        req.params.id
                    )
                    .single();

            if (
                noteResult.error ||
                !noteResult.data
            ) {
                return res
                    .status(404)
                    .json({
                        success: false,
                        message:
                            "الملاحظة غير موجودة."
                    });
            }

            if (
                !teacherCanAccessSubject(
                    verification,
                    noteResult.data.subject
                )
            ) {
                return res
                    .status(403)
                    .json({
                        success: false,
                        message:
                            "لا يمكنك حذف ملاحظة تابعة لمادة أخرى."
                    });
            }

            const result =
                await supabase
                    .from("platform_notes")
                    .delete()
                    .eq(
                        "id",
                        req.params.id
                    );

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
                    "تم حذف الملاحظة بنجاح."
            });

        } catch (error) {
            console.error(
                "Platform note delete error:",
                error
            );

            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        "حدث خطأ أثناء حذف الملاحظة."
                });
        }
    }
);


/* =========================================================
   منصة المؤسسة - تسجيل مشاهدة الملاحظة
========================================================= */

app.post(
    "/api/platform/notes/:id/view",
    async function (req, res) {
        try {
            const verification = await verifyPlatformUser(req);

            if (!verification.success) {
                return res.status(verification.status).json({
                    success: false,
                    message: verification.message
                });
            }

            if (verification.profile.role !== "student") {
                return res.json({ success: true });
            }

            const noteResult = await supabase
                .from("platform_notes")
                .select("id, branch, year, subject")
                .eq("id", req.params.id)
                .single();

            if (noteResult.error || !noteResult.data) {
                return res.status(404).json({
                    success: false,
                    message: "الملاحظة غير موجودة."
                });
            }

            const note = noteResult.data;

            if (
                note.branch !== verification.studentBranch ||
                Number(note.year) !== Number(verification.studentYear)
            ) {
                return res.status(403).json({
                    success: false,
                    message: "لا يمكنك تسجيل مشاهدة هذه الملاحظة."
                });
            }

            const result = await supabase
                .from("platform_note_views")
                .upsert(
                    {
                        note_id: note.id,
                        user_id: verification.user.id,
                        viewed_at: new Date().toISOString()
                    },
                    {
                        onConflict: "note_id,user_id"
                    }
                );

            if (result.error) {
                console.warn("Note view tracking warning:", result.error.message);
                return res.json({
                    success: true,
                    tracking: false
                });
            }

            return res.json({
                success: true,
                tracking: true
            });
        } catch (error) {
            console.error("Note view error:", error);
            return res.json({
                success: true,
                tracking: false
            });
        }
    }
);

/* =========================================================
   منصة المؤسسة - من شاهد الملاحظة
========================================================= */

app.get(
    "/api/platform/notes/:id/viewers",
    async function (req, res) {
        try {
            const verification = await verifyPlatformUser(req);

            if (!verification.success) {
                return res.status(verification.status).json({
                    success: false,
                    message: verification.message
                });
            }

            if (
                verification.profile.role !== "teacher" &&
                verification.profile.role !== "admin" &&
                verification.profile.role !== "programmer"
            ) {
                return res.status(403).json({
                    success: false,
                    message: "هذه المعلومات متاحة للطاقم المخول فقط."
                });
            }

            const noteResult = await supabase
                .from("platform_notes")
                .select("id, subject, created_by")
                .eq("id", req.params.id)
                .single();

            if (noteResult.error || !noteResult.data) {
                return res.status(404).json({
                    success: false,
                    message: "الملاحظة غير موجودة."
                });
            }

            if (
                verification.profile.role === "teacher" &&
                !teacherCanAccessSubject(verification, noteResult.data.subject)
            ) {
                return res.status(403).json({
                    success: false,
                    message: "يمكن للأستاذ مشاهدة متابعات ملاحظات مادته فقط."
                });
            }

            const viewsResult = await supabase
                .from("platform_note_views")
                .select("user_id, viewed_at")
                .eq("note_id", req.params.id)
                .order("viewed_at", { ascending: false });

            if (viewsResult.error) {
                return res.status(500).json({
                    success: false,
                    message:
                        "لم يتم إعداد سجل مشاهدات الملاحظات في قاعدة البيانات."
                });
            }

            const ids = (viewsResult.data || []).map(v => v.user_id).filter(Boolean);
            let profiles = [];

            if (ids.length) {
                const profilesResult = await supabase
                    .from("profiles")
                    .select("id, full_name")
                    .in("id", [...new Set(ids)]);

                if (!profilesResult.error) {
                    profiles = profilesResult.data || [];
                }
            }

            const names = Object.fromEntries(
                profiles.map(p => [p.id, p.full_name || "تلميذ"])
            );

            return res.json({
                success: true,
                viewers: (viewsResult.data || []).map(v => ({
                    user_id: v.user_id,
                    full_name: names[v.user_id] || "تلميذ",
                    viewed_at: v.viewed_at
                }))
            });
        } catch (error) {
            console.error("Note viewers error:", error);
            return res.status(500).json({
                success: false,
                message: "حدث خطأ أثناء جلب قائمة المشاهدين."
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

    async function (req, res) {
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

            if (!drive) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "Google Drive غير متصل بالخادم."
                    });
            }

            const verification =
                await verifyUser(req);

            if (!verification.success) {
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

            if (!pdfFile) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "يرجى اختيار ملف PDF."
                    });
            }

            if (!coverFile) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "يرجى اختيار صورة غلاف الكتاب."
                    });
            }

            const uploadedFileName =
                pdfFile.originalname.toLowerCase();

            const isPdf =
                pdfFile.mimetype ===
                    "application/pdf" ||
                uploadedFileName.endsWith(".pdf");

            if (!isPdf) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "يسمح برفع ملفات PDF فقط."
                    });
            }

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

            console.error(error);

            if (
                uploadedPdfId &&
                drive
            ) {
                try {
                    await drive.files.delete({
                        fileId:
                            uploadedPdfId
                    });
                } catch (deleteError) {
                    console.error(
                        "تعذر حذف PDF بعد الخطأ:",
                        deleteError
                    );
                }
            }

            if (
                uploadedCoverId &&
                drive
            ) {
                try {
                    await drive.files.delete({
                        fileId:
                            uploadedCoverId
                    });
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
    async function (req, res) {
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

            const verification =
                await verifyUser(req);

            if (!verification.success) {
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

            let pdfDeleted = false;

            if (
                book.drive_file_id &&
                drive
            ) {
                try {
                    await drive.files.delete({
                        fileId:
                            book.drive_file_id
                    });

                    pdfDeleted = true;

                } catch (driveError) {
                    const driveStatus =
                        driveError &&
                        driveError.response
                            ? driveError.response.status
                            : null;

                    if (
                        driveStatus === 404
                    ) {
                        pdfDeleted = true;
                    } else {
                        console.error(
                            "خطأ أثناء حذف PDF:",
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

            let coverFileId = null;

            if (book.cover_url) {
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

            let coverDeleted = false;

            if (
                coverFileId &&
                drive
            ) {
                try {
                    await drive.files.delete({
                        fileId:
                            coverFileId
                    });

                    coverDeleted = true;

                } catch (coverError) {
                    const coverStatus =
                        coverError &&
                        coverError.response
                            ? coverError.response.status
                            : null;

                    if (
                        coverStatus === 404
                    ) {
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
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "تم حذف ملفات الكتاب من Google Drive لكن حدث خطأ أثناء حذف سجل الكتاب من قاعدة البيانات."
                    });
            }

            return res.json({
                success: true,

                message:
                    "تم حذف الكتاب والغلاف بنجاح.",

                bookId:
                    book.id,

                title:
                    book.title,

                pdfDeleted:
                    pdfDeleted,

                coverDeleted:
                    coverDeleted
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
    async function (req, res) {
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
========================================================= */

app.get(
    "/api/books/:id/pdf",
    async function (req, res) {
        let driveStream = null;

        try {
            const verification =
                await verifyUser(req);

            if (!verification.success) {
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

            if (!book.drive_file_id) {
                return res
                    .status(404)
                    .json({
                        success: false,
                        message:
                            "ملف PDF غير مرتبط بهذا الكتاب."
                    });
            }

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

            console.log(
                "================================="
            );

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

            if (!req.headers.range) {
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
                    function (error) {
                        console.error(
                            "PDF stream error:",
                            error
                        );

                        if (!res.headersSent) {
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

            if (
                start !== null &&
                end === null
            ) {
                end =
                    fileSize - 1;
            }

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

            driveStream.on(
                "error",
                function (error) {
                    console.error(
                        "Google Drive Range stream error:",
                        error
                    );

                    if (!res.headersSent) {
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

            if (!res.headersSent) {
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
   منصة المؤسسة - فتح ملف PDF
========================================================= */


/* =========================================================
   منصة المؤسسة - تعديل ملف درس
========================================================= */

app.put(
    "/api/platform/files/:id",
    async function (req, res) {
        try {
            const verification =
                await verifyPlatformUser(req);

            if (!verification.success) {
                return res.status(verification.status).json({
                    success: false,
                    message: verification.message
                });
            }

            if (verification.profile.role === "student") {
                return res.status(403).json({
                    success: false,
                    message: "التلميذ لا يملك صلاحية تعديل الدروس."
                });
            }

            const fileResult = await supabase
                .from("platform_files")
                .select("id, title, description, branch, year, subject, uploaded_by")
                .eq("id", req.params.id)
                .single();

            if (fileResult.error || !fileResult.data) {
                return res.status(404).json({
                    success: false,
                    message: "الدرس غير موجود."
                });
            }

            const file = fileResult.data;

            if (
                verification.profile.role === "teacher" &&
                !teacherCanAccessSubject(verification, file.subject)
            ) {
                return res.status(403).json({
                    success: false,
                    message: "يمكن للأستاذ تعديل دروس مادته فقط."
                });
            }

            const title = String(req.body.title || "").trim();
            const description = String(req.body.description || "").trim();

            if (!title) {
                return res.status(400).json({
                    success: false,
                    message: "عنوان الدرس مطلوب."
                });
            }

            const updateResult = await supabase
                .from("platform_files")
                .update({
                    title,
                    description,
                    updated_at: new Date().toISOString()
                })
                .eq("id", req.params.id);

            if (updateResult.error) {
                return res.status(500).json({
                    success: false,
                    message: updateResult.error.message
                });
            }

            return res.json({
                success: true,
                message: "تم تعديل بيانات الدرس بنجاح."
            });
        } catch (error) {
            console.error("Platform file update error:", error);
            return res.status(500).json({
                success: false,
                message: "حدث خطأ أثناء تعديل الدرس."
            });
        }
    }
);

/* =========================================================
   منصة المؤسسة - حذف ملف درس
========================================================= */

app.delete(
    "/api/platform/files/:id",
    async function (req, res) {
        try {
            const verification =
                await verifyPlatformUser(req);

            if (!verification.success) {
                return res.status(verification.status).json({
                    success: false,
                    message: verification.message
                });
            }

            if (verification.profile.role === "student") {
                return res.status(403).json({
                    success: false,
                    message: "التلميذ لا يملك صلاحية حذف الدروس."
                });
            }

            const fileResult = await supabase
                .from("platform_files")
                .select("id, subject, uploaded_by, drive_file_id")
                .eq("id", req.params.id)
                .single();

            if (fileResult.error || !fileResult.data) {
                return res.status(404).json({
                    success: false,
                    message: "الدرس غير موجود."
                });
            }

            const file = fileResult.data;

            if (
                verification.profile.role === "teacher" &&
                !teacherCanAccessSubject(verification, file.subject)
            ) {
                return res.status(403).json({
                    success: false,
                    message: "يمكن للأستاذ حذف دروس مادته فقط."
                });
            }

            if (drive && file.drive_file_id) {
                try {
                    await drive.files.delete({
                        fileId: file.drive_file_id
                    });
                } catch (driveError) {
                    console.warn(
                        "Google Drive delete warning:",
                        driveError.message
                    );
                }
            }

            const deleteResult = await supabase
                .from("platform_files")
                .delete()
                .eq("id", req.params.id);

            if (deleteResult.error) {
                return res.status(500).json({
                    success: false,
                    message: deleteResult.error.message
                });
            }

            return res.json({
                success: true,
                message: "تم حذف الدرس بنجاح."
            });
        } catch (error) {
            console.error("Platform file delete error:", error);
            return res.status(500).json({
                success: false,
                message: "حدث خطأ أثناء حذف الدرس."
            });
        }
    }
);

app.get(
    "/api/platform/files/:id/pdf",
    async function (req, res) {
        let driveStream = null;

        try {
            const verification =
                await verifyPlatformUser(req);

            if (!verification.success) {
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

            const fileResult =
                await supabase
                    .from("platform_files")
                    .select(
                        "id, title, branch, year, subject, drive_file_id"
                    )
                    .eq(
                        "id",
                        req.params.id
                    )
                    .single();

            if (
                fileResult.error ||
                !fileResult.data
            ) {
                return res
                    .status(404)
                    .json({
                        success: false,
                        message:
                            "ملف المنصة غير موجود."
                    });
            }

            const platformFile =
                fileResult.data;

            if (verification.profile.role === "student") {
                const fileBranch = platformFile.branch;
                const fileYear = Number(platformFile.year);

                if (
                    fileBranch !== verification.studentBranch ||
                    fileYear !== verification.studentYear
                ) {
                    return res.status(403).json({
                        success: false,
                        message: "لا يمكنك الوصول إلى هذا الدرس."
                    });
                }
            }

            /*
               الأستاذ يستطيع فتح ملفات مادته فقط.
            */

            if (
                verification.profile.role ===
                "teacher" &&
                !teacherCanAccessSubject(
                    verification,
                    platformFile.subject
                )
            ) {
                return res
                    .status(403)
                    .json({
                        success: false,
                        message:
                            "لا يمكنك الوصول إلى ملف تابع لمادة أخرى."
                    });
            }

            if (
                !platformFile.drive_file_id
            ) {
                return res
                    .status(404)
                    .json({
                        success: false,
                        message:
                            "ملف PDF غير مرتبط بهذا العنصر."
                    });
            }

            if (!drive) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "Google Drive غير متصل بالخادم."
                    });
            }

            const metadataResponse =
                await drive.files.get({
                    fileId:
                        platformFile.drive_file_id,

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

            const safeTitle =
                (
                    platformFile.title ||
                    "platform-file"
                )
                    .replace(
                        /[\/\\:*?"<>|]/g,
                        "_"
                    )
                    .trim() ||
                "platform-file";

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

            if (!req.headers.range) {
                res.setHeader(
                    "Content-Length",
                    String(fileSize)
                );

                const driveResponse =
                    await drive.files.get(
                        {
                            fileId:
                                platformFile.drive_file_id,

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
                    function (error) {
                        console.error(
                            "Platform PDF stream error:",
                            error
                        );

                        if (!res.headersSent) {
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

            if (
                start !== null &&
                end === null
            ) {
                end =
                    fileSize - 1;
            }

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

            if (
                end >= fileSize
            ) {
                end =
                    fileSize - 1;
            }

            const chunkSize =
                end - start + 1;

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

            const driveResponse =
                await drive.files.get(
                    {
                        fileId:
                            platformFile.drive_file_id,

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

            driveStream.on(
                "error",
                function (error) {
                    console.error(
                        "Platform PDF Range stream error:",
                        error
                    );

                    if (!res.headersSent) {
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

        } catch (error) {
            console.error(
                "Platform PDF reader error:",
                error
            );

            if (
                driveStream &&
                !driveStream.destroyed
            ) {
                driveStream.destroy();
            }

            if (!res.headersSent) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "تعذر فتح ملف منصة المؤسسة.",
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
                    "نظام وثائق التسجيل: مفعّل"
                );

                console.log(
                    "نظام مواد الأساتذة: مفعّل"
                );

                console.log(
                    "منصة المؤسسة: مفعّلة"
                );

                console.log(
                    "صلاحيات منصة المؤسسة: مفعّلة"
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