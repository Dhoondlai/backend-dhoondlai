import { type Request, type Response } from "express";
import { collections } from "../config/db";
import { logger } from "../libs/logger";

export const getProduct = async (req: Request, res: Response) => {
  try {
    const { name } = req.body;

    const products = await collections.products
      ?.find({ standard_name: name }, { projection: { _id: 0 } })
      .toArray();

    return res.status(200).send({
      status: 200,
      success: true,
      message: "Product Fetched successfully.",
      length: products?.length,
      data: products,
    });
  } catch (errRes) {
    logger.error(errRes);
    return res.status(errRes.response.statusCode ?? 500).send({
      status: errRes.response.statusCode ?? 500,
      success: false,
      message: errRes.body.message as string,
    });
  }
};

export const searchProduct = async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    const searchQuery = typeof name === "string" ? name : "";
    const products = await collections.products
      ?.aggregate([
        { $match: { $text: { $search: searchQuery } } },
        { $addFields: { score: { $meta: "textScore" } } },
        {
          $group: {
            _id: "$standard_name",
            doc: { $first: "$$ROOT" },
          },
        },
        // Restructure to return just the document
        { $replaceRoot: { newRoot: "$doc" } },
        { $sort: { score: -1 } },
      ])
      .toArray();

    return res.status(200).send({
      status: 200,
      success: true,
      message: "Product Fetched successfully.",
      length: products?.length,
      data: products,
    });
  } catch (errRes) {
    logger.error(errRes);
    return res.status(errRes.response.statusCode ?? 500).send({
      status: errRes.response.statusCode ?? 500,
      success: false,
      message: errRes.body.message as string,
    });
  }
};

export const getAllProducts = async (req: Request, res: Response) => {
  try {
    // Get pagination parameters from query, default to page 1 with 10 items per page
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    // Get category filter from query parameters
    const category = req.query.category as string;

    // Get sorting parameter from query
    const sortBy = req.query.sortBy as string;

    // Build match stage for category filter
    const matchStage: any = {};
    if (category) {
      matchStage.category = { $regex: category, $options: "i" }; // Case-insensitive match
    }

    // Build sort stage based on sortBy parameter
    let sortStage: any = { standard_name: 1 }; // Default sort by name
    switch (sortBy?.toLowerCase()) {
      case "price_max":
      case "maximum_price":
        sortStage = { best_price: -1 }; // Highest price first
        break;
      case "price_min":
      case "minimum_price":
        sortStage = { best_price: 1 }; // Lowest price first
        break;
      case "vendors_max":
      case "maximum_vendors":
        sortStage = { vendors_count: -1 }; // Most vendors first
        break;
      default:
        sortStage = { standard_name: 1 }; // Default alphabetical sort
        break;
    }

    // First count unique standard_names for total count (with category filter if provided)
    const countPipeline: any[] = [];
    if (Object.keys(matchStage).length > 0) {
      countPipeline.push({ $match: matchStage });
    }
    countPipeline.push({ $group: { _id: "$standard_name" } });
    countPipeline.push({ $count: "total" });

    const countResult = await collections.products
      ?.aggregate(countPipeline)
      .toArray();
    const uniqueProductsCount = countResult?.[0]?.total || 0;

    // Build aggregation pipeline with optional category filter
    const pipeline: any[] = [];

    // Add match stage if category filter is provided
    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    // Add the rest of the aggregation pipeline
    pipeline.push(
      // Group by standard_name
      {
        $group: {
          _id: "$standard_name",
          vendors_count: { $sum: 1 }, // Count products with same standard_name
          // Find the minimum price and corresponding vendor
          min_price: { $min: "$current_price" },
          all_products: {
            $push: {
              vendor: "$vendor",
              current_price: "$current_price",
              category: "$category",
              available: "$available",
            },
          },
        },
      },
      // Add best price vendor field
      {
        $addFields: {
          best_price_vendor: {
            $arrayElemAt: [
              {
                $filter: {
                  input: "$all_products",
                  as: "product",
                  cond: { $eq: ["$$product.current_price", "$min_price"] },
                },
              },
              0,
            ],
          },
        },
      },
      // Project final fields
      {
        $project: {
          _id: 0,
          standard_name: "$_id",
          vendors_count: 1,
          best_price: "$min_price",
          best_price_vendor: "$best_price_vendor.vendor",
          category: { $arrayElemAt: ["$all_products.category", 0] },
          available: { $in: [true, "$all_products.available"] }, // Available if any vendor has it
        },
      },
      { $sort: sortStage },
      { $skip: skip },
      { $limit: limit },
    );

    // Fetch products with the built pipeline
    const products = await collections.products?.aggregate(pipeline).toArray();

    return res.status(200).send({
      status: 200,
      success: true,
      message: "Products fetched successfully.",
      filter: category ? { category } : null,
      sort: sortBy || "standard_name",
      pagination: {
        total: uniqueProductsCount,
        page,
        limit,
        pages: Math.ceil(uniqueProductsCount / limit),
      },
      length: products?.length,
      data: products,
    });
  } catch (errRes) {
    logger.error(errRes);
    return res.status(errRes.response?.statusCode ?? 500).send({
      status: errRes.response?.statusCode ?? 500,
      success: false,
      message: errRes.message || "Internal server error",
    });
  }
};
