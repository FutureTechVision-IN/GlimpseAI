import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import mediaRouter from "./media";
import plansRouter from "./plans";
import paymentsRouter from "./payments";
import adminRouter from "./admin";
import providerKeysRouter from "./provider-keys";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(mediaRouter);
router.use(plansRouter);
router.use(paymentsRouter);
router.use(adminRouter);
router.use(providerKeysRouter);

export default router;
