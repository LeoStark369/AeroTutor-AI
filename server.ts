import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "25mb" }));

// Initialize Gemini Client lazily or gracefully handle missing key
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// API Routes
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    appName: "AeroTutor AI",
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
  });
});

// AI Tutor Chat Route
app.post("/api/gemini/tutor", async (req, res) => {
  try {
    const { message, tutorMode = "Student", documentContext = "", history = [], image = null } = req.body;
    const ai = getGeminiClient();

    let systemInstruction = `You are AeroTutor AI, an expert, encouraging STEM and Aerospace Engineering AI tutor.
Your goal is to help students truly understand complex concepts rather than just memorizing them.
Current Tutor Mode: "${tutorMode}".
Adapt your tone and depth based on the Tutor Mode:
- Beginner: Explain using intuitive everyday analogies, simple language, no dense math.
- Student: School/undergrad level, balanced theory with fundamental equations.
- Advanced: Deep mathematical rigor, calculus, derivations, precise physical laws.
- Engineering: Use formal engineering terms, governing equations, real-world aerospace assumptions, boundary conditions, and practical design applications.
- Exam Mode: Focus on problem-solving strategies, common traps, key formulas, and step-by-step exam techniques.
- Socratic Mode: CRITICAL - Do NOT give the direct final answer! Ask guiding questions that help the student reason step-by-step toward the answer.

Format technical answers cleanly into these distinct visual sections when applicable:
### Answer
(Short direct explanation)

### Why?
(Conceptual background)

### Equation
(Relevant formulas with defined variables in SI units)

### Worked Example
(A clear numerical or conceptual example)

### Try It Yourself
(A quick practice challenge question for the student)`;

    if (documentContext) {
      systemInstruction += `\n\n[DOCUMENT CONTEXT]: The user is asking about an uploaded textbook or material:\n"""\n${documentContext.slice(0, 8000)}\n"""\nPrioritize content from this document. Clearly prefix statements derived directly from it with "According to your document:". For general knowledge, mark it as "Additional explanation:".`;
    }

    if (!ai) {
      // Fallback intelligent responses if API key is not yet set up
      const mockResponse = getMockTutorResponse(message, tutorMode, documentContext);
      return res.json({ response: mockResponse, isFallback: true });
    }

    const contentsParts: any[] = [];
    if (image && typeof image === "string" && image.startsWith("data:")) {
      const match = image.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
      if (match) {
        contentsParts.push({
          inlineData: {
            mimeType: match[1],
            data: match[2],
          },
        });
      }
    }
    contentsParts.push({ text: message });

    const formattedHistory = history.map((h: { role: string; content: string }) => ({
      role: h.role === "user" ? "user" : "model",
      parts: [{ text: h.content }],
    }));

    let fullContents = [...formattedHistory];
    if (fullContents.length > 0) {
      fullContents.push({ role: "user", parts: contentsParts });
    } else {
      fullContents = contentsParts;
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: fullContents as any,
      config: {
        systemInstruction,
        temperature: 0.7,
      },
    });

    res.json({ response: response.text || "No response generated." });
  } catch (error: any) {
    console.error("Gemini Tutor Error:", error);
    res.status(500).json({ error: error.message || "Failed to generate AI response." });
  }
});

// Document Analysis Route
app.post("/api/gemini/analyze-doc", async (req, res) => {
  try {
    const { text, title = "Uploaded Document" } = req.body;
    const ai = getGeminiClient();

    if (!ai || !text || text.length < 20) {
      // Fallback summary engine data
      return res.json({
        summary30s: `This document "${title}" covers key STEM principles, defining foundational equations, core concepts, and practical engineering applications.`,
        summary5m: `Comprehensive overview of ${title}. It introduces foundational definitions, mathematical frameworks, and real-world system behaviors essential for aerospace and technical fields.`,
        summaryDetailed: `Detailed breakdown of ${title}: 1. Core Principles & Assumptions. 2. Key Mathematical Formulations. 3. System Analysis and Performance Constraints. 4. Practical Engineering Applications.`,
        chapters: ["Introduction & Fundamentals", "Governing Equations", "Practical Applications & Case Studies", "Summary & Review"],
        keyConcepts: ["Boundary Conditions", "Conservation Laws", "System Efficiency", "Dimensional Analysis"],
        formulas: [
          { name: "Lift Equation", formula: "L = 1/2 * ρ * V² * S * C_L", description: "Calculates aerodynamic lift force based on dynamic pressure and lift coefficient." },
          { name: "Continuity Equation", formula: "A₁V₁ = A₂V₂", description: "Mass conservation for incompressible fluid flow through a conduit." }
        ],
        keyTerms: [
          { term: "Angle of Attack (AoA)", definition: "The angle between the chord line of an airfoil and the oncoming freestream velocity vector." },
          { term: "Reynolds Number", definition: "A dimensionless parameter representing the ratio of inertial forces to viscous forces in fluid flow." }
        ],
        examRevision: [
          "Understand the physical meaning of dynamic pressure q = 0.5 * ρ * V².",
          "Be prepared to draw free-body force diagrams showing Lift, Drag, Thrust, and Weight.",
          "Know when to apply compressible vs incompressible flow assumptions."
        ]
      });
    }

    const prompt = `Analyze the following educational material titled "${title}":
"""
${text.slice(0, 12000)}
"""

Provide a JSON summary object with exact keys:
- summary30s (string, concise 2-sentence summary)
- summary5m (string, 2 paragraph overview)
- summaryDetailed (string, comprehensive bulleted breakdown)
- chapters (array of 3-6 chapter/section strings)
- keyConcepts (array of 4-8 concept strings)
- formulas (array of objects with name, formula, description)
- keyTerms (array of objects with term, definition)
- examRevision (array of 3-5 high-value revision bullet points)
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const parsed = JSON.parse(response.text || "{}");
    res.json(parsed);
  } catch (error: any) {
    console.error("Doc Analysis Error:", error);
    res.status(500).json({ error: error.message || "Failed to analyze document." });
  }
});

// Automatic Quiz Generator Route
app.post("/api/gemini/generate-quiz", async (req, res) => {
  try {
    const { topic = "Aerodynamics", difficulty = "Medium", questionCount = 5, documentContext = "" } = req.body;
    const ai = getGeminiClient();

    if (!ai) {
      return res.json({ questions: getMockQuizQuestions(topic, difficulty, Number(questionCount)) });
    }

    const prompt = `Generate an educational quiz on topic: "${topic}", difficulty: "${difficulty}", question count: ${questionCount}.
${documentContext ? `Base questions strictly on this reference material:\n"""\n${documentContext.slice(0, 6000)}\n"""` : ""}

Return a JSON array of question objects. Each object must have:
- id (string)
- type ("multiple-choice" | "true-false" | "numerical")
- question (string)
- options (array of strings for multiple-choice/true-false, empty array for numerical)
- correctAnswer (string or number matching correct option exactly)
- explanation (string detailed step-by-step breakdown)
- conceptTag (string e.g. "Vectors", "Bernoulli Principle", "Orbital Mechanics")
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const questions = JSON.parse(response.text || "[]");
    res.json({ questions });
  } catch (error: any) {
    console.error("Quiz Gen Error:", error);
    res.status(500).json({ error: error.message || "Failed to generate quiz." });
  }
});

// Mock Fallback Helpers
function getMockTutorResponse(msg: string, mode: string, docCtx: string) {
  const lower = msg.toLowerCase();
  if (lower.includes("angle of attack") || lower.includes("lift")) {
    return `### Answer
Increasing the angle of attack (AoA) increases the camber deflections and pressure differential between the upper and lower surfaces of the airfoil, producing higher lift up to the critical stall angle.

### Why?
As AoA increases, fluid on the upper surface speeds up relative to the lower surface. By Bernoulli's principle, higher velocity means lower pressure above the wing, producing upward net force (Lift). Beyond the critical AoA (~15°), boundary layer separation occurs, causing aerodynamic stall.

### Equation
$$C_L = 2\\pi \\alpha$$ (for thin airfoils at low AoA, where $\\alpha$ is in radians)
$$L = \\frac{1}{2} \\rho V^2 S C_L$$

### Worked Example
If airspeed $V = 100 \\text{ m/s}$, air density $\\rho = 1.225 \\text{ kg/m}^3$, wing area $S = 20 \\text{ m}^2$, and $C_L$ increases from 0.4 to 0.8:
- Initial Lift: $L = 0.5 \\times 1.225 \\times 100^2 \\times 20 \\times 0.4 = 49,000 \\text{ N}$
- Doubled $C_L$ Lift: $L = 98,000 \\text{ N}$

### Try It Yourself
What happens to total aerodynamic lift if flight speed is doubled while keeping the angle of attack constant? (Hint: Notice the velocity squared term in dynamic pressure!).`;
  }
  return `### Answer
Great question regarding STEM principles! ${mode === "Socratic Mode" ? "Before giving the final answer, consider: what fundamental conservation law governs this behavior?" : "Let's break down the underlying physics and mathematics clearly."}

### Why?
Every physical process in aerospace and engineering obeys conservation of mass, momentum, and energy. Analyzing system boundaries helps isolate unknown forces and state variables.

### Equation
$$F_{net} = m \\cdot a = \\frac{dp}{dt}$$

### Worked Example
Consider a control volume with mass flow rate $\\dot{m} = 5 \\text{ kg/s}$ and velocity change $\\Delta V = 200 \\text{ m/s}$:
$$T = \\dot{m} \\cdot \\Delta V = 5 \\times 200 = 1000 \\text{ N}$$

### Try It Yourself
How would the required force change if the mass flow rate was cut in half while keeping thrust constant?`;
}

function getMockQuizQuestions(topic: string, diff: string, count: number) {
  const bank = [
    {
      id: "q1",
      type: "multiple-choice",
      question: "What physical principle primarily explains the pressure drop over the curved upper surface of an airfoil?",
      options: ["Newton's Third Law", "Bernoulli's Principle", "Kepler's Second Law", "Hooke's Law"],
      correctAnswer: "Bernoulli's Principle",
      explanation: "Bernoulli's equation states that for an inviscid flow, an increase in fluid speed occurs simultaneously with a decrease in static pressure.",
      conceptTag: "Aerodynamics"
    },
    {
      id: "q2",
      type: "true-false",
      question: "Exceeding the critical angle of attack causes boundary layer separation and aerodynamic stall.",
      options: ["True", "False"],
      correctAnswer: "True",
      explanation: "At high angles of attack, the adverse pressure gradient becomes too steep for the boundary layer, leading to airflow detachment.",
      conceptTag: "Flight Mechanics"
    },
    {
      id: "q3",
      type: "numerical",
      question: "Calculate the orbital velocity (in m/s) of a satellite in low Earth orbit at radius r = 6,700,000 m. (G*M_earth = 3.986e14 m³/s²).",
      options: [],
      correctAnswer: "7709",
      explanation: "v = sqrt(GM / r) = sqrt(3.986e14 / 6.7e6) ≈ 7709 m/s.",
      conceptTag: "Orbital Mechanics"
    },
    {
      id: "q4",
      type: "multiple-choice",
      question: "Which term represents the ratio of aircraft speed to the local speed of sound?",
      options: ["Reynolds Number", "Froude Number", "Mach Number", "Prandtl Number"],
      correctAnswer: "Mach Number",
      explanation: "Mach number M = V / a, where V is speed and a is the local speed of sound.",
      conceptTag: "Compressible Flow"
    },
    {
      id: "q5",
      type: "multiple-choice",
      question: "What parameter measures rocket engine efficiency in terms of thrust produced per mass flow rate of propellant?",
      options: ["Specific Impulse (Isp)", "Thrust Coefficient", "Mass Ratio", "Burn Rate"],
      correctAnswer: "Specific Impulse (Isp)",
      explanation: "Specific Impulse (Isp) is measured in seconds and represents how effectively propellant mass is converted into momentum.",
      conceptTag: "Propulsion"
    }
  ];
  return bank.slice(0, count);
}

// Vite Server Setup
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`AeroTutor AI Server running on http://localhost:${PORT}`);
  });
}

startServer();
